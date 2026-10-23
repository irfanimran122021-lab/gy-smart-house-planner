import { z } from 'zod';
export const evidenceSchema = z.object({
  measurements: z
    .array(
      z.object({
        field: z.string(),
        value: z.number().nullable(),
        unit: z.enum(['ft', 'in', 'm', 'mm', 'count']).nullable(),
        source: z.string(),
        confidence: z.enum(['high', 'medium', 'low']),
        note: z.string(),
      }),
    )
    .max(100),
  conflicts: z.array(z.string()).max(30),
  observations: z.array(z.string()).max(50),
  missing: z.array(z.string()).max(50),
});
export type Evidence = z.infer<typeof evidenceSchema>;
export const evidenceJSON = {
  type: 'object',
  additionalProperties: false,
  required: ['measurements', 'conflicts', 'observations', 'missing'],
  properties: {
    measurements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'value', 'unit', 'source', 'confidence', 'note'],
        properties: {
          field: { type: 'string' },
          value: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'], enum: ['ft', 'in', 'm', 'mm', 'count', null] },
          source: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { type: 'string' },
        },
      },
    },
    conflicts: { type: 'array', items: { type: 'string' } },
    observations: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
  },
};
export const editSchema = z.object({
  message: z.string().max(3000),
  changes: z
    .array(
      z.object({
        target: z.enum(['requirements', 'room']),
        id: z.string(),
        field: z.string(),
        value: z.union([z.string(), z.number()]),
      }),
    )
    .max(30),
});
export const editJSON = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'changes'],
  properties: {
    message: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'id', 'field', 'value'],
        properties: {
          target: { type: 'string', enum: ['requirements', 'room'] },
          id: { type: 'string' },
          field: { type: 'string' },
          value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        },
      },
    },
  },
};
export function validateUpload(file: { name: string; type: string; size: number }) {
  const types: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  };
  if (!types[file.type]) throw Error('Use JPG, PNG, WEBP or PDF.');
  if (file.size <= 0 || file.size > 3 * 1024 * 1024)
    throw Error('Each file must be between 1 byte and 3 MB. Compress larger scans first.');
  if (!/\.(jpe?g|png|webp|pdf)$/i.test(file.name))
    throw Error('File extension must match an accepted format.');
}
