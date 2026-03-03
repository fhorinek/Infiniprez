import { z } from 'zod'
import { CURRENT_SCHEMA_VERSION, type DocumentModel } from './types'

const nonEmptyStringSchema = z.string().trim().min(1)
const idSchema = nonEmptyStringSchema
const isoTimestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected ISO timestamp',
})
const colorSchema = nonEmptyStringSchema

const textRunSchema = z.object({
  text: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  color: colorSchema,
  fontSize: z.number().positive(),
})

const textboxDataSchema = z.object({
  runs: z.array(textRunSchema),
  fontFamily: nonEmptyStringSchema,
  alignment: z.enum(['left', 'center', 'right']),
  listType: z.enum(['none', 'bullet', 'numbered']),
  autoHeight: z.boolean(),
})

const imageDataSchema = z.object({
  assetId: idSchema,
  intrinsicWidth: z.number().positive(),
  intrinsicHeight: z.number().positive(),
  keepAspectRatio: z.boolean(),
})

const fillGradientSchema = z.object({
  colorA: colorSchema,
  colorB: colorSchema,
  angleDeg: z.number().min(-360).max(360),
})

const shapeDataSchema = z
  .object({
    borderColor: colorSchema,
    borderType: z.enum(['solid', 'dashed', 'dotted']),
    borderWidth: z.number().min(0).max(20),
    fillMode: z.enum(['solid', 'linearGradient']),
    fillColor: colorSchema,
    fillGradient: fillGradientSchema.nullable(),
    opacityPercent: z.number().min(0).max(100),
  })
  .superRefine((value, ctx) => {
    if (value.fillMode === 'solid' && value.fillGradient !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fillGradient must be null when fillMode is solid',
        path: ['fillGradient'],
      })
    }

    if (value.fillMode === 'linearGradient' && value.fillGradient === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fillGradient is required when fillMode is linearGradient',
        path: ['fillGradient'],
      })
    }
  })

const groupDataSchema = z.object({
  childIds: z.array(idSchema).superRefine((value, ctx) => {
    if (new Set(value).size !== value.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'childIds must not contain duplicates',
      })
    }
  }),
})

const baseObjectSchema = z.object({
  id: idSchema,
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: z.number(),
  locked: z.boolean(),
  zIndex: z.number().int(),
  parentGroupId: idSchema.nullable(),
})

const textboxObjectSchema = baseObjectSchema.extend({
  type: z.literal('textbox'),
  textboxData: textboxDataSchema,
})

const imageObjectSchema = baseObjectSchema.extend({
  type: z.literal('image'),
  imageData: imageDataSchema,
})

const shapeRectObjectSchema = baseObjectSchema.extend({
  type: z.literal('shape_rect'),
  shapeData: shapeDataSchema,
})

const shapeCircleObjectSchema = baseObjectSchema.extend({
  type: z.literal('shape_circle'),
  shapeData: shapeDataSchema,
})

const shapeArrowObjectSchema = baseObjectSchema.extend({
  type: z.literal('shape_arrow'),
  shapeData: shapeDataSchema,
})

const groupObjectSchema = baseObjectSchema.extend({
  type: z.literal('group'),
  groupData: groupDataSchema,
})

const slideSchema = z.object({
  id: idSchema,
  name: nonEmptyStringSchema,
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
  rotation: z.number(),
  triggerMode: z.enum(['manual', 'timed']),
  triggerDelayMs: z.number().int().min(0).max(3_600_000),
  transitionType: z.enum(['ease', 'linear', 'instant']),
  transitionDurationMs: z.number().int().min(1_000).max(10_000),
  orderIndex: z.number().int().nonnegative(),
})

const assetSchema = z.object({
  id: idSchema,
  name: nonEmptyStringSchema,
  mimeType: nonEmptyStringSchema,
  dataBase64: nonEmptyStringSchema,
})

export const documentSchema = z.object({
  meta: z.object({
    version: z.literal(CURRENT_SCHEMA_VERSION),
    title: nonEmptyStringSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  }),
  canvas: z.object({
    gridVisible: z.boolean(),
    baseGridSize: z.number().positive(),
    snapToGrid: z.boolean(),
    snapToObjectEdges: z.boolean(),
    snapTolerancePx: z.number().positive(),
  }),
  slides: z.array(slideSchema),
  objects: z.array(
    z.discriminatedUnion('type', [
      textboxObjectSchema,
      imageObjectSchema,
      shapeRectObjectSchema,
      shapeCircleObjectSchema,
      shapeArrowObjectSchema,
      groupObjectSchema,
    ])
  ),
  assets: z.array(assetSchema),
})

export type DocumentInput = z.input<typeof documentSchema>
export type DocumentOutput = z.output<typeof documentSchema>

export function validateDocument(input: unknown): DocumentOutput {
  return documentSchema.parse(input)
}

export function safeValidateDocument(input: unknown) {
  return documentSchema.safeParse(input)
}

export function isDocument(input: unknown): input is DocumentModel {
  return safeValidateDocument(input).success
}
