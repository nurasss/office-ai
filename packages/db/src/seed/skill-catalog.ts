import type { Database } from '../client.js'
import { skills } from '../schema/catalog.js'

export const SEED_SKILLS = [
  {
    id: '01918361-b4f7-7890-c000-000000000001',
    key: 'nodejs',
    name: 'Node.js Backend Development',
    description: 'Server-side application engineering, asynchronous I/O, streams, and runtime debugging.',
    category: 'engineering' as const,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-c000-000000000002',
    key: 'typescript',
    name: 'TypeScript',
    description: 'Advanced static type system design, generics, project references, and linting.',
    category: 'engineering' as const,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-c000-000000000003',
    key: 'react',
    name: 'React Frontend',
    description: 'Modern component architecture, state management, hooks, and responsive UI layout.',
    category: 'engineering' as const,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-c000-000000000004',
    key: 'postgresql',
    name: 'PostgreSQL Database',
    description: 'Relational data modeling, indexing strategies, transactions, and performance tuning.',
    category: 'engineering' as const,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-c000-000000000005',
    key: 'docker',
    name: 'Docker & Containerization',
    description: 'Multi-stage Dockerfiles, compose environments, image optimization, and orchestration.',
    category: 'engineering' as const,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-c000-000000000006',
    key: 'aws',
    name: 'Amazon Web Services',
    description: 'Cloud infrastructure provisioning, IAM least-privilege policies, S3, and serverless compute.',
    category: 'engineering' as const,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-c000-000000000007',
    key: 'seo',
    name: 'Search Engine Optimization',
    description: 'Keyword research, semantic structure, backlink analysis, and technical search audit.',
    category: 'marketing' as const,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-c000-000000000008',
    key: 'google_ads',
    name: 'Google Ads & PPC',
    description: 'Campaign setup, ad copy optimization, bid strategies, and ROAS performance tracking.',
    category: 'marketing' as const,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-c000-000000000009',
    key: 'accounting',
    name: 'Financial Accounting & Ledger',
    description: 'General ledger maintenance, reconciliation, cashflow budgeting, and tax compliance.',
    category: 'finance' as const,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-c000-000000000010',
    key: 'market_research',
    name: 'Market & Competitive Intelligence',
    description: 'Competitor benchmarking, TAM analysis, customer persona discovery, and industry reports.',
    category: 'research' as const,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-c000-000000000011',
    key: 'legal_research',
    name: 'Legal & Regulatory Compliance',
    description: 'Terms of service analysis, privacy compliance (GDPR/CCPA), and regulatory research.',
    category: 'legal' as const,
    status: 'active' as const,
  },
  {
    id: '01918361-b4f7-7890-c000-000000000012',
    key: 'sales',
    name: 'B2B Enterprise Sales',
    description: 'Lead qualification, outbound prospecting, value proposition pitch, and pipeline management.',
    category: 'operations' as const,
    status: 'active' as const,
  },
]

export async function seedSkillCatalog(db: Database): Promise<void> {
  for (const skill of SEED_SKILLS) {
    await db
      .insert(skills)
      .values(skill)
      .onConflictDoUpdate({
        target: skills.key,
        set: {
          name: skill.name,
          description: skill.description,
          category: skill.category,
          status: skill.status,
          updatedAt: new Date(),
        },
      })
  }
}
