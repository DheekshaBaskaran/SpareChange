/**
 * Duo 1 owns one PostgreSQL schema in the shared Tiger Data database.
 *
 * Market Intelligence (Python) owns `public` and is authoritative for market
 * data. Duo 1 (finance, CREAO, Elastic projection) owns `relay`, which avoids
 * the two independent `market_observations` / `market_offers` / `schema_migrations`
 * definitions colliding on one database.
 */
export const DUO1_SCHEMA = "relay";
export const SEARCH_PATH = `${DUO1_SCHEMA},public`;

/** PostgreSQL startup parameter so every pooled connection gets the same path. */
export const SEARCH_PATH_OPTION = `-c search_path=${SEARCH_PATH}`;

export const CREATE_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS ${DUO1_SCHEMA}`;
export const SET_SEARCH_PATH_SQL = `SET search_path TO ${SEARCH_PATH}`;
