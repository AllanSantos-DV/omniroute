import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/shared/utils/apiAuth";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";
import {
  getFreeModelTypeOverrides,
  listFreeModelTypeOverrides,
  setFreeModelTypeOverride,
} from "@/lib/db/freeModelOverrides";

/** Valid freeTypes — must stay in sync with `FreeModelFreeType` in open-sse/config/freeModelCatalog.ts. */
const VALID_FREE_TYPES = [
  "recurring-daily",
  "recurring-monthly",
  "recurring-credit",
  "recurring-uncapped",
  "one-time-initial",
  "keyless",
  "discontinued",
] as const;

/**
 * GET /api/settings/free-model-type-overrides
 * Lists every operator-set freeType override (newest first) plus the count of rows
 * the steady-free pool filter will honor at request time.
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const overrides = listFreeModelTypeOverrides();
    return NextResponse.json({
      overrides,
      count: overrides.length,
      appliedCount: getFreeModelTypeOverrides().size,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeErrorMessage(error) }, { status: 500 });
  }
}

const putOverrideSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  freeType: z.string().min(1).optional(),
  note: z.string().optional(),
});

/**
 * PUT /api/settings/free-model-type-overrides
 * Set (or, with `freeType` omitted, remove) a runtime freeType override for an exact
 * (provider, modelId). The override REPLACES the compiled catalog's freeType for that
 * model in the steady-free pool filter — no rebuild or redeploy required.
 */
export async function PUT(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateBody(putOverrideSchema, rawBody);
  if (isValidationFailure(validation)) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { provider, modelId, freeType, note } = validation.data;

  if (freeType !== undefined && !(VALID_FREE_TYPES as readonly string[]).includes(freeType)) {
    return NextResponse.json(
      {
        error: `Invalid freeType "${freeType}". Allowed: ${VALID_FREE_TYPES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  try {
    const override = setFreeModelTypeOverride(provider, modelId, freeType ?? null, note ?? "");
    return NextResponse.json({
      provider,
      modelId,
      freeType: freeType ?? null,
      status: freeType ? "set" : "removed",
      override,
    });
  } catch (error) {
    return NextResponse.json({ error: sanitizeErrorMessage(error) }, { status: 500 });
  }
}
