/** E: logged workouts keep the name they were done under (template renames / deletes never change history). */
import type { WeightDB } from '../../db/schema';
import type { ID } from '../../db/types';

/** E: freeze the template name on sessions that do not have it yet (all, or those of one template). Idempotent. */
export async function freezeTemplateNames(db: WeightDB, templateId?: ID): Promise<number> {
  return db.transaction('rw', db.sessions, db.templates, async () => {
    const names = new Map((await db.templates.toArray()).map((x) => [x.id, x.name]));
    const coll = templateId ? db.sessions.where('templateId').equals(templateId) : db.sessions.toCollection();
    return coll.filter((s) => !!s.templateId && s.templateName === undefined && names.has(s.templateId)).modify((s) => { s.templateName = names.get(s.templateId!); });
  });
}

