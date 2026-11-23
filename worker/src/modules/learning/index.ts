/**
 * Learning brick: KAVOX's translation memory. It learns, mechanically and in the open, from the
 * corrections people make to translations (a rule is used for everyone once enough different
 * people made the same correction, or an admin approved it) and from the glossary admins write.
 * It also learns speech fixes: words the speech recognition keeps getting wrong, from people's
 * corrections of the recognised text. And it learns which download method works for each site.
 * Every job is sent the rules for its language; the Space applies them before its model.
 * This file is the brick's only public interface.
 */
export { LEARNING_SCHEMA, LEARN_VOTES, norm } from './store';
export { learnFromEdit, memoryFor, speechFix } from './service';
export { handleMemoryAdmin } from './handlers';
export { SITES_SCHEMA, downloadPlanFor, sitesJobListener } from './sites';
export { ASPECTS, RATINGS_SCHEMA, rate, ratingsOf, type Aspect } from './ratings';
