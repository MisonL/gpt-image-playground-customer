# Agent API and Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable AI Agent API with idempotency, structured errors, artifact tracking, SQLite/PostgreSQL state backends, Docker deployment templates, and a repository skill package.

**Architecture:** Keep the existing web UI API stable and add `/api/agent/*` as the machine-oriented contract. Store request state and artifact metadata in SQLite or PostgreSQL while keeping image binaries on the filesystem.

**Tech Stack:** Next.js App Router, OpenAI JavaScript SDK, better-sqlite3, pg, node:test, Docker Compose.

---

## Tasks

- [x] Add Agent contracts, structured errors, and auth helpers.
- [x] Add SQLite and PostgreSQL state store implementations.
- [x] Add Agent generate, edit, capabilities, OpenAPI, artifact metadata, content, and delete routes.
- [x] Add database schema files and Docker/PostgreSQL deployment template.
- [x] Add repository skill package with scripts and API reference.
- [x] Run full validation: test, lint, build, Docker compose checks.
