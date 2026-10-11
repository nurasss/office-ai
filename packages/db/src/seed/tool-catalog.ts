import type { Database } from '../client.js'
import { tools } from '../schema/catalog.js'

export const SEED_TOOLS = [
  {
    id: '01918361-b4f7-7890-b000-000000000001',
    key: 'web_search',
    name: 'Web Search',
    description: 'Execute internet search query across search engines and retrieve ranked URLs and snippets.',
    category: 'research' as const,
    autonomyLevel: 0,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or query' },
        limit: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: { type: 'array', items: { type: 'object' } },
      },
    },
    requiredSecretKey: null,
    isReadOnly: true,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000002',
    key: 'web_fetch',
    name: 'Web Fetch',
    description: 'Fetch and parse HTML/text contents of a specific web URL.',
    category: 'research' as const,
    autonomyLevel: 0,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri', description: 'Target URL' },
      },
      required: ['url'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        status: { type: 'number' },
      },
    },
    requiredSecretKey: null,
    isReadOnly: true,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000003',
    key: 'file_read',
    name: 'File Read',
    description: 'Read the contents of a local repository file.',
    category: 'system' as const,
    autonomyLevel: 0,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file' },
      },
      required: ['path'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
      },
    },
    requiredSecretKey: null,
    isReadOnly: true,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000004',
    key: 'knowledge_search',
    name: 'Knowledge Base Search',
    description: 'Search vector and keyword documents in corporate knowledge base.',
    category: 'research' as const,
    autonomyLevel: 0,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Semantic search query' },
        limit: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        documents: { type: 'array', items: { type: 'object' } },
      },
    },
    requiredSecretKey: null,
    isReadOnly: true,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000005',
    key: 'db_query_readonly',
    name: 'Database Readonly Query',
    description: 'Execute read-only SQL SELECT queries against organization read replica database.',
    category: 'data' as const,
    autonomyLevel: 0,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL SELECT query' },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'object' } },
      },
    },
    requiredSecretKey: null,
    isReadOnly: true,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000006',
    key: 'file_write',
    name: 'File Write',
    description: 'Create or update file contents in workspace.',
    category: 'system' as const,
    autonomyLevel: 1,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to file' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
      },
    },
    requiredSecretKey: null,
    isReadOnly: false,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000007',
    key: 'task_create',
    name: 'Task Create',
    description: 'Create a new internal subtask or workflow ticket.',
    category: 'system' as const,
    autonomyLevel: 1,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        assignedAgentId: { type: 'string', format: 'uuid' },
      },
      required: ['title', 'description'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', format: 'uuid' },
      },
    },
    requiredSecretKey: null,
    isReadOnly: false,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000008',
    key: 'github_repo_read',
    name: 'GitHub Repository Read',
    description: 'Inspect repository metadata, issues, and code tree from GitHub.',
    category: 'development' as const,
    autonomyLevel: 0,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository full name (owner/repo)' },
      },
      required: ['repo'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        repository: { type: 'object' },
      },
    },
    requiredSecretKey: 'GITHUB_TOKEN',
    isReadOnly: true,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000009',
    key: 'github_branch_create',
    name: 'GitHub Branch Create',
    description: 'Create a git branch in a GitHub repository.',
    category: 'development' as const,
    autonomyLevel: 1,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository full name' },
        branch: { type: 'string', description: 'New branch name' },
        fromBranch: { type: 'string', default: 'main' },
      },
      required: ['repo', 'branch'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        branchRef: { type: 'string' },
      },
    },
    requiredSecretKey: 'GITHUB_TOKEN',
    isReadOnly: false,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000010',
    key: 'github_pr_create',
    name: 'GitHub PR Create',
    description: 'Open a pull request on GitHub.',
    category: 'development' as const,
    autonomyLevel: 2,
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository full name' },
        title: { type: 'string', description: 'PR title' },
        head: { type: 'string', description: 'Source branch' },
        base: { type: 'string', default: 'main' },
        body: { type: 'string' },
      },
      required: ['repo', 'title', 'head'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        prNumber: { type: 'number' },
        prUrl: { type: 'string' },
      },
    },
    requiredSecretKey: 'GITHUB_TOKEN',
    isReadOnly: false,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000011',
    key: 'send_email',
    name: 'Send Email',
    description: 'Send outbound email to external recipient via corporate SMTP/SES.',
    category: 'communication' as const,
    autonomyLevel: 2,
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', format: 'email' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
      },
    },
    requiredSecretKey: 'SMTP_CREDENTIALS',
    isReadOnly: false,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000012',
    key: 'publish_article',
    name: 'Publish Article',
    description: 'Publish article or marketing blog post to corporate CMS.',
    category: 'communication' as const,
    autonomyLevel: 2,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        slug: { type: 'string' },
      },
      required: ['title', 'content'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        postId: { type: 'string' },
        url: { type: 'string' },
      },
    },
    requiredSecretKey: 'CMS_API_KEY',
    isReadOnly: false,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000013',
    key: 'payment_execute',
    name: 'Payment Execute',
    description: 'Execute external payment or corporate funds transfer.',
    category: 'finance' as const,
    autonomyLevel: 3,
    inputSchema: {
      type: 'object',
      properties: {
        recipient: { type: 'string' },
        amount: { type: 'string', description: 'Monetary amount' },
        currency: { type: 'string', default: 'USD' },
      },
      required: ['recipient', 'amount'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        transactionId: { type: 'string' },
        status: { type: 'string' },
      },
    },
    requiredSecretKey: 'STRIPE_SECRET_KEY',
    isReadOnly: false,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-b000-000000000014',
    key: 'prod_data_delete',
    name: 'Production Data Delete',
    description: 'Delete or purge production records from database or object store.',
    category: 'system' as const,
    autonomyLevel: 3,
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Target resource' },
        filter: { type: 'object' },
        confirmation: { type: 'boolean' },
      },
      required: ['target', 'confirmation'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        deletedCount: { type: 'number' },
      },
    },
    requiredSecretKey: null,
    isReadOnly: false,
    status: 'active' as const,
  },
]

export async function seedToolCatalog(db: Database): Promise<void> {
  for (const tool of SEED_TOOLS) {
    await db
      .insert(tools)
      .values(tool)
      .onConflictDoUpdate({
        target: tools.key,
        set: {
          name: tool.name,
          description: tool.description,
          category: tool.category,
          autonomyLevel: tool.autonomyLevel,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          requiredSecretKey: tool.requiredSecretKey,
          isReadOnly: tool.isReadOnly,
          status: tool.status,
          updatedAt: new Date(),
        },
      })
  }
}
