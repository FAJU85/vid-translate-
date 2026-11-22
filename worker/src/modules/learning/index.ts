/**
 * Learning brick: KAVOX's translation memory. It learns, mechanically and in the open, from the
 * corrections people make to translations (a rule is used for everyone once enough different
 * people made the same correction, or an admin approved it) and from the glossary admins write.
 * Every job is sent the rules for its language; the Space applies them before its model.
 * This file is the brick's only public interface.
 */
export { LEARNING_SCHEMA, LEARN_VOTES, norm } from './store';
export { learnFromEdit, memoryFor } from './service';
export { handleMemoryAdmin } from './handlers';
