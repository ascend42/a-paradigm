/**
 * Fixtures Tools - MCP tools for retrieving test fixtures
 *
 * Provides:
 * - paradigm_test_fixtures: Get test fixtures for validating flows
 */

import type { ProjectContext } from '../utils/index-loader.js';
import {
  loadFixtures,
  getFixturesByCategory,
  getFixtureByName,
  getAvailableFixtures,
} from '../utils/fixtures-loader.js';

/**
 * Tool result type
 */
export interface ToolResult {
  handled: boolean;
  text: string;
}

/**
 * Get the list of fixtures tools
 */
export function getFixturesToolsList() {
  return [
    {
      name: 'paradigm_test_fixtures',
      description:
        'Get test fixtures for validating flows. Returns users (for auth testing), resources (for entity testing), and sample payloads (for API testing).',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['users', 'resources', 'payloads', 'all'],
            description:
              'Category of fixtures to retrieve. Use "all" to get everything.',
          },
          name: {
            type: 'string',
            description:
              'Specific fixture name within the category (e.g., "admin", "createTask")',
          },
        },
      },
    },
  ];
}

/**
 * Handle fixtures tool calls
 */
export async function handleFixturesTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ProjectContext
): Promise<ToolResult> {
  switch (name) {
    case 'paradigm_test_fixtures': {
      const { category, name: fixtureName } = args as {
        category?: 'users' | 'resources' | 'payloads' | 'all';
        name?: string;
      };

      // Load fixtures
      const fixtures = await loadFixtures(ctx.rootDir);

      if (!fixtures) {
        const text = JSON.stringify(
          {
            error: 'Fixtures not found',
            suggestion:
              'Create .paradigm/fixtures.yaml with test fixtures. Run `paradigm init` to generate a template.',
            example: `
version: "1.0"

users:
  admin:
    id: "user-admin"
    email: "admin@test.com"
    role: "org-admin"
    token: "Bearer admin-token-xxx"
  member:
    id: "user-alice"
    email: "alice@test.com"
    role: "member"
    token: "Bearer alice-token-xxx"

resources:
  project:
    id: "project-1"
    name: "Test Project"
    members: ["user-alice"]
    admins: ["user-admin"]

payloads:
  createTask:
    title: "New Task"
    description: "Task description"
`,
          },
          null,
          2
        );
        return { handled: true, text };
      }

      // If no category specified, show available fixtures
      if (!category) {
        const available = getAvailableFixtures(fixtures);
        const text = JSON.stringify(
          {
            available,
            usage: {
              getAllUsers: 'paradigm_test_fixtures({ category: "users" })',
              getSpecificUser:
                'paradigm_test_fixtures({ category: "users", name: "admin" })',
              getAllPayloads: 'paradigm_test_fixtures({ category: "payloads" })',
              getEverything: 'paradigm_test_fixtures({ category: "all" })',
            },
          },
          null,
          2
        );
        return { handled: true, text };
      }

      // If name specified, get specific fixture
      if (fixtureName && category !== 'all') {
        const fixture = getFixtureByName(fixtures, category, fixtureName);

        if (!fixture) {
          const available = getAvailableFixtures(fixtures);
          const text = JSON.stringify(
            {
              error: `Fixture "${fixtureName}" not found in category "${category}"`,
              availableInCategory:
                available[category as keyof typeof available] || [],
            },
            null,
            2
          );
          return { handled: true, text };
        }

        const text = JSON.stringify(fixture, null, 2);
        return { handled: true, text };
      }

      // Get fixtures by category
      const result = getFixturesByCategory(fixtures, category);
      const text = JSON.stringify(result, null, 2);
      return { handled: true, text };
    }

    default:
      return { handled: false, text: '' };
  }
}
