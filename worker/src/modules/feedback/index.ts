/**
 * Feedback brick: what people tell KAVOX, from the website's "Send feedback" button and the
 * bot's /feedback command, kept for the admin to read on the /admin page.
 * This file is the brick's only public interface.
 */
export { FEEDBACK_SCHEMA } from './store';
export { MAX_FEEDBACK, handleFeedback, handleFeedbackAdmin, telegramFeedback } from './handlers';
