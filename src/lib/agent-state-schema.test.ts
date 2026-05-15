import { POSTGRES_SCHEMA } from './agent-state-postgres';
import { SQLITE_SCHEMA } from './agent-state-sqlite';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('Agent state schema files', () => {
    it('keeps the SQLite runtime schema in sync with database/sqlite-agent-state.sql', () => {
        assert.equal(normalizeSql(SQLITE_SCHEMA), readSchemaFile('sqlite-agent-state.sql'));
    });

    it('keeps the PostgreSQL runtime schema in sync with database/postgres-agent-state.sql', () => {
        assert.equal(normalizeSql(POSTGRES_SCHEMA), readSchemaFile('postgres-agent-state.sql'));
    });
});

function readSchemaFile(filename: string): string {
    return normalizeSql(readFileSync(path.join(process.cwd(), 'database', filename), 'utf8'));
}

function normalizeSql(value: string): string {
    return value.replace(/\r\n/g, '\n').trim();
}
