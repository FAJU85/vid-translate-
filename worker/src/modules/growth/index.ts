/**
 * Growth brick: anonymous daily counts of how people arrive (visits by source), spread KAVOX
 * (shares by app) and install the app, for the admin's Growth page. No personal data.
 * This file is the brick's only public interface.
 */
export { GROWTH_SCHEMA, sweepGrowth } from './store';
export { handleGrowth, handleGrowthAdmin, registerJobsPerDay, type JobsPerDay } from './handlers';
