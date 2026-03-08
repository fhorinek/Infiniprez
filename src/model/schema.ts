import { z } from 'zod'
import { CURRENT_SCHEMA_VERSION, DEFAULT_CANVAS_BACKGROUND, type DocumentModel } from './types'
import {
  DEFAULT_TARGET_FRAME_HEIGHT,
  DEFAULT_TARGET_FRAME_WIDTH,
  diagonalFromZoom,
} from '../slideDiagonal'

const nonEmptyStringSchema = z.string().trim().min(1)
const idSchema = nonEmptyStringSchema
const MAX_OBJECT_RADIUS_PX = 1000000
const isoTimestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected ISO timestamp',
})
const colorSchema = nonEmptyStringSchema
const gradientStopSchema = z.object({
  color: colorSchema,
  positionPercent: z.number().min(0).max(100),
  xPercent: z.number().min(0).max(100).optional(),
  yPercent: z.number().min(0).max(100).optional(),
})

const textRunSchema = z.object({
  text: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  color: colorSchema,
  fontSize: z.number().positive(),
})

const fillGradientSchema = z
  .object({
  colorA: colorSchema,
  colorB: colorSchema,
  angleDeg: z.number().min(-360).max(360),
    gradientType: z.enum(['linear', 'radial', 'circles']).default('linear'),
    stops: z.array(gradientStopSchema).max(5).default([]),
  })
  .transform((value) => {
    const normalizedStops =
      value.stops.length >= 2
        ? [...value.stops]
            .map((stop) => ({
              color: stop.color,
              positionPercent: Math.max(0, Math.min(100, stop.positionPercent)),
              xPercent:
                stop.xPercent === undefined ? undefined : Math.max(0, Math.min(100, stop.xPercent)),
              yPercent:
                stop.yPercent === undefined ? undefined : Math.max(0, Math.min(100, stop.yPercent)),
            }))
            .sort((a, b) => a.positionPercent - b.positionPercent)
        : [
            { color: value.colorA, positionPercent: 0 },
            { color: value.colorB, positionPercent: 100 },
          ]

    const trimmedStops = normalizedStops.slice(0, 5)
    const firstStop = trimmedStops[0] ?? { color: value.colorA, positionPercent: 0 }
    const lastStop = trimmedStops[trimmedStops.length - 1] ?? {
      color: value.colorB,
      positionPercent: 100,
    }

    return {
      ...value,
      colorA: firstStop.color,
      colorB: lastStop.color,
      stops: trimmedStops,
    }
  })

const textboxDataSchema = z
  .object({
    runs: z.array(textRunSchema),
    richTextHtml: z.string(),
    fontFamily: nonEmptyStringSchema,
    alignment: z.enum(['left', 'center', 'right']),
    verticalAlignment: z.enum(['top', 'middle', 'bottom']).default('top'),
    listType: z.enum(['none', 'bullet', 'numbered']),
    autoHeight: z.boolean(),
    fillMode: z.enum(['solid', 'linearGradient']).default('solid'),
    backgroundColor: colorSchema.default('#1f3151'),
    fillGradient: fillGradientSchema.nullable().default(null),
    borderColor: colorSchema.default('#b2c6ee'),
    borderType: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
    borderWidth: z.number().min(0).max(20).default(1),
    radius: z.number().min(0).max(MAX_OBJECT_RADIUS_PX).default(0),
    opacityPercent: z.number().min(0).max(100).default(100),
    shadowColor: colorSchema.default('#000000'),
    shadowBlurPx: z.number().min(0).max(200).default(0),
    shadowAngleDeg: z.number().min(-180).max(180).default(45),
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

const imageDataSchema = z.object({
  assetId: idSchema,
  intrinsicWidth: z.number().positive(),
  intrinsicHeight: z.number().positive(),
  borderColor: colorSchema.default('#b2c6ee'),
  borderType: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  borderWidth: z.number().min(0).max(20).default(0),
  radius: z.number().min(0).max(MAX_OBJECT_RADIUS_PX).default(0),
  opacityPercent: z.number().min(0).max(100).default(100),
  cropEnabled: z.boolean().default(false),
  cropLeftPercent: z.number().min(0).max(100).default(0),
  cropTopPercent: z.number().min(0).max(100).default(0),
  cropRightPercent: z.number().min(0).max(100).default(0),
  cropBottomPercent: z.number().min(0).max(100).default(0),
  effectsEnabled: z.boolean().default(false),
  filterPreset: z
    .enum(['none', 'bw', 'sepia', 'vibrant', 'warm', 'cool', 'dramatic'])
    .default('none'),
  shadowColor: colorSchema.default('#000000'),
  shadowBlurPx: z.number().min(0).max(200).default(0),
  shadowAngleDeg: z.number().min(-180).max(180).default(45),
})

const videoDataSchema = z.object({
  assetId: idSchema,
  intrinsicWidth: z.number().positive(),
  intrinsicHeight: z.number().positive(),
  borderColor: colorSchema.default('#b2c6ee'),
  borderType: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  borderWidth: z.number().min(0).max(20).default(0),
  radius: z.number().min(0).max(MAX_OBJECT_RADIUS_PX).default(0),
  opacityPercent: z.number().min(0).max(100).default(100),
  autoplay: z.boolean().default(false),
  loop: z.boolean().default(true),
  muted: z.boolean().default(true),
  shadowColor: colorSchema.default('#000000'),
  shadowBlurPx: z.number().min(0).max(200).default(0),
  shadowAngleDeg: z.number().min(-180).max(180).default(45),
})

const soundDataSchema = z.object({
  assetId: idSchema,
  borderColor: colorSchema.default('#b2c6ee'),
  borderType: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  borderWidth: z.number().min(0).max(20).default(0),
  radius: z.number().min(0).max(MAX_OBJECT_RADIUS_PX).default(18),
  opacityPercent: z.number().min(0).max(100).default(100),
  loop: z.boolean().default(false),
  shadowColor: colorSchema.default('#000000'),
  shadowBlurPx: z.number().min(0).max(200).default(0),
  shadowAngleDeg: z.number().min(-180).max(180).default(45),
})

const shapeDataSchema = z
  .object({
    kind: z.enum([
      'rect',
      'roundedRect',
      'diamond',
      'triangle',
      'trapezoid',
      'parallelogram',
      'hexagon',
      'pentagon',
      'octagon',
      'star',
      'cloud',
    ]),
    adjustmentPercent: z.number().min(0).max(100),
    borderColor: colorSchema,
    borderType: z.enum(['solid', 'dashed', 'dotted']),
    borderWidth: z.number().min(0).max(20),
    fillMode: z.enum(['solid', 'linearGradient']),
    fillColor: colorSchema,
    fillGradient: fillGradientSchema.nullable(),
    radius: z.number().min(0).max(MAX_OBJECT_RADIUS_PX).default(0),
    opacityPercent: z.number().min(0).max(100),
    shadowColor: colorSchema.default('#000000'),
    shadowBlurPx: z.number().min(0).max(200).default(0),
    shadowAngleDeg: z.number().min(-180).max(180).default(45),
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

const templatePlaceholderDataSchema = z.object({
  kind: z.enum(['universal', 'text', 'list', 'image']),
  prompt: nonEmptyStringSchema,
})

const baseObjectSchema = z.object({
  id: idSchema,
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: z.number(),
  scalePercent: z.number().positive().default(100),
  keepAspectRatio: z.boolean().default(false),
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

const videoObjectSchema = baseObjectSchema.extend({
  type: z.literal('video'),
  videoData: videoDataSchema,
})

const soundObjectSchema = baseObjectSchema.extend({
  type: z.literal('sound'),
  soundData: soundDataSchema,
})

const shapeRectObjectSchema = baseObjectSchema.extend({
  type: z.literal('shape_rect'),
  shapeData: shapeDataSchema,
})

const shapeCircleObjectSchema = baseObjectSchema.extend({
  type: z.literal('shape_circle'),
  shapeData: shapeDataSchema,
})

const groupObjectSchema = baseObjectSchema.extend({
  type: z.literal('group'),
  groupData: groupDataSchema,
})

const templatePlaceholderObjectSchema = baseObjectSchema.extend({
  type: z.literal('template_placeholder'),
  templatePlaceholderData: templatePlaceholderDataSchema,
})

const slideSchema = z
  .object({
    id: idSchema,
    name: nonEmptyStringSchema,
    x: z.number(),
    y: z.number(),
    diagonal: z.number().positive().optional(),
    zoom: z.number().positive().optional(),
    rotation: z.number(),
    triggerMode: z.enum(['manual', 'timed']),
    triggerDelayMs: z.number().int().min(0).max(60_000),
    transitionType: z.enum(['ease', 'linear', 'instant']),
    transitionDurationMs: z.number().int().min(0).max(10_000),
    orderIndex: z.number().int().nonnegative(),
  })
  .transform((slide) => {
    const diagonal =
      slide.diagonal ??
      diagonalFromZoom(
        slide.zoom ?? 1,
        DEFAULT_TARGET_FRAME_WIDTH,
        DEFAULT_TARGET_FRAME_HEIGHT
      )
    const { zoom: _zoom, ...rest } = slide
    return {
      ...rest,
      diagonal,
    }
  })
  .superRefine((slide, ctx) => {
    if (
      slide.transitionType !== 'instant' &&
      (slide.transitionDurationMs < 1_000 || slide.transitionDurationMs > 10_000)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['transitionDurationMs'],
        message: 'transitionDurationMs must be in 1000..10000 when transitionType is not instant',
      })
    }
  })

const assetSchema = z.object({
  id: idSchema,
  name: nonEmptyStringSchema,
  mimeType: nonEmptyStringSchema,
  dataBase64: nonEmptyStringSchema,
  intrinsicWidth: z.number().positive().nullable().optional(),
  intrinsicHeight: z.number().positive().nullable().optional(),
  durationSec: z.number().nonnegative().nullable().optional(),
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
    background: z.string().trim().min(1).default(DEFAULT_CANVAS_BACKGROUND),
  }),
  slides: z.array(slideSchema),
  objects: z.array(
    z.discriminatedUnion('type', [
      textboxObjectSchema,
      imageObjectSchema,
      videoObjectSchema,
      soundObjectSchema,
      shapeRectObjectSchema,
      shapeCircleObjectSchema,
      templatePlaceholderObjectSchema,
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
