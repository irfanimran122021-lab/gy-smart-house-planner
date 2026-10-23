import { authorize, runAI, apiFailure, APIError } from '../../../lib/server-ai';
import { editJSON, editSchema } from '../../../lib/ai';
import { projectSchema } from '../../../lib/model';
export const maxDuration = 120;
export async function POST(req: Request) {
  try {
    await authorize(req);
    if (Number(req.headers.get('content-length')) > 1000000)
      throw new APIError('Project is too large for assistant context.', 413);
    const body = await req.json(),
      p = projectSchema.parse(body.project);
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 3000)
      throw new APIError('Enter a request under 3,000 characters.');
    const output = await runAI(
      editJSON,
      'drawing_edit',
      'Propose precise edits in millimetres. Never claim certification or approval. Only requirements fields width,length,floors,apartments,bedrooms,bathrooms,front,rear,left,right,roof,veranda,parking,futureFloors,instructions and room fields name,x,y,w,h can change. Room id must exist. Do not change rooms and requirements together. Changing requirements regenerates the constrained layout and needs validation. Unknown measurements need clarification in message with changes empty. All edits need human preview.',
      [
        {
          type: 'input_text',
          text: JSON.stringify({
            request: body.prompt,
            requirements: p.requirements,
            floors: p.floors.map((f) => ({ id: f.id, rooms: f.rooms })),
          }),
        },
      ],
    );
    return Response.json(editSchema.parse(output));
  } catch (e) {
    return apiFailure(e);
  }
}
