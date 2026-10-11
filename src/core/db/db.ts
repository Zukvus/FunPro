import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  ActivityLogEntry,
  AutoReplyRule,
  Balance,
  ChatMessage,
  ChatSummary,
  CompetitorSnapshot,
  Customer,
  Delivery,
  DomainEvent,
  FinanceOperation,
  InventoryItem,
  InventoryPool,
  Listing,
  MessageTemplate,
  NotificationItem,
  Order,
  PriceRule,
  Review,
  ReviewTemplate,
  Task,
  WorkflowRule,
} from '@/shared/models';

/** Snapshot of listings taken before any bulk operation so it can be restored. */
export interface BackupRecord {
  id: string;
  kind: 'bulk_edit' | 'import' | 'manual' | 'reorder';
  createdAt: number;
  label: string;
  listings: Listing[];
}

/** One entry per automatic reply FunPro sent — used for cooldowns, dedupe and loop prevention. */
export interface ReplyLedgerEntry {
  /** `${chatId}:${triggerMessageId}` — a message is answered at most once. */
  id: string;
  chatId: string;
  ruleId: string;
  at: number;
  text: string;
}

export interface DraftReply {
  id: string;
  chatId: string;
  /** Message that triggered the draft (null for manual). */
  triggerMessageId: string | null;
  source: 'auto_reply' | 'ai' | 'review' | 'workflow' | 'scheduled' | 'delivery';
  text: string;
  status: 'pending' | 'approved' | 'sent' | 'dismissed' | 'failed';
  createdAt: number;
  updatedAt: number;
  /** For scheduled messages: epoch ms. */
  sendAt: number | null;
  meta?: Record<string, unknown>;
}

export interface BumpState {
  /** Game (category) id — FunPay raises per game. */
  gameId: string;
  nodeIds: string[];
  categoryName: string;
  status: 'idle' | 'waiting' | 'raised' | 'error' | 'needs_selection';
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextEligibleAt: number | null;
  lastMessage: string;
  consecutiveFailures: number;
}

export interface AssetRecord {
  id: string;
  kind: 'sound' | 'background';
  name: string;
  mime: string;
  blob: Blob;
  createdAt: number;
}

export interface SecretRecord {
  name: string;
  iv: string;
  cipher: string;
  updatedAt: number;
}

export interface KeyRecord {
  name: string;
  key: CryptoKey;
}

export interface KvRecord {
  key: string;
  value: unknown;
}

export class FunProDB extends Dexie {
  listings!: EntityTable<Listing, 'id'>;
  orders!: EntityTable<Order, 'id'>;
  chats!: EntityTable<ChatSummary, 'id'>;
  messages!: Table<ChatMessage, [string, string]>;
  reviews!: EntityTable<Review, 'orderId'>;
  financeOps!: EntityTable<FinanceOperation, 'id'>;
  balances!: Table<Balance & { id?: number }, number>;
  customers!: EntityTable<Customer, 'id'>;
  inventoryPools!: EntityTable<InventoryPool, 'id'>;
  inventoryItems!: EntityTable<InventoryItem, 'id'>;
  deliveries!: EntityTable<Delivery, 'orderId'>;
  competitorSnapshots!: EntityTable<CompetitorSnapshot, 'id'>;
  priceRules!: EntityTable<PriceRule, 'listingId'>;
  templates!: EntityTable<MessageTemplate, 'id'>;
  autoReplyRules!: EntityTable<AutoReplyRule, 'id'>;
  reviewTemplates!: EntityTable<ReviewTemplate, 'id'>;
  workflowRules!: EntityTable<WorkflowRule, 'id'>;
  events!: EntityTable<DomainEvent, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  logs!: Table<ActivityLogEntry, number>;
  notifications!: EntityTable<NotificationItem, 'id'>;
  backups!: EntityTable<BackupRecord, 'id'>;
  replyLedger!: EntityTable<ReplyLedgerEntry, 'id'>;
  drafts!: EntityTable<DraftReply, 'id'>;
  bumpState!: EntityTable<BumpState, 'gameId'>;
  assets!: EntityTable<AssetRecord, 'id'>;
  secrets!: EntityTable<SecretRecord, 'name'>;
  keys!: EntityTable<KeyRecord, 'name'>;
  kv!: EntityTable<KvRecord, 'key'>;

  constructor(name = 'funpro') {
    super(name);
    this.version(1).stores({
      listings: 'id, nodeId, gameId, active, categoryName, sortIndex',
      orders: 'id, direction, status, createdAt, counterpartyName, counterpartyId, [direction+status]',
      chats: 'id, updatedAt, partnerName, partnerId, unread',
      messages: '[chatId+id], chatId, at, kind',
      reviews: 'orderId, stars, firstSeenAt',
      financeOps: 'id, kind, at',
      balances: '++id, at',
      customers: 'id, name, lastSeenAt, pinned, followUpAt, *tags',
      inventoryPools: 'id, *listingIds',
      inventoryItems: 'id, poolId, [poolId+status], &fingerprint, orderId, status',
      deliveries: 'orderId, status, updatedAt',
      competitorSnapshots: 'id, nodeId, offerId, at, [nodeId+at], [offerId+at]',
      priceRules: 'listingId, enabled',
      templates: 'id, command, name',
      autoReplyRules: 'id, priority, enabled',
      reviewTemplates: 'id, stars',
      workflowRules: 'id, trigger, priority, enabled',
      events: 'id, type, at',
      tasks: 'id, &idempotencyKey, status, nextRunAt, kind, [status+nextRunAt]',
      logs: '++id, at, level, source',
      notifications: 'id, at, kind, read',
      backups: 'id, createdAt, kind',
      replyLedger: 'id, chatId, ruleId, at, [chatId+at]',
      drafts: 'id, chatId, status, createdAt, sendAt',
      bumpState: 'gameId, status, nextEligibleAt',
      assets: 'id, kind',
      secrets: 'name',
      keys: 'name',
      kv: 'key',
    });
  }
}

let instance: FunProDB | null = null;

/**
 * Lazily-created singleton. The database lives in the extension origin, so it is shared by the
 * background service worker, popup and dashboard — but NOT by content scripts, which run in the
 * funpay.com origin and must go through runtime messaging.
 */
export function getDb(): FunProDB {
  instance ??= new FunProDB();
  return instance;
}

/** Test helper: swap in a fresh database. */
export function resetDbForTests(name = `funpro-test-${Math.random().toString(36).slice(2)}`): FunProDB {
  instance = new FunProDB(name);
  return instance;
}

/** Tables whose contents are user data and are included in backups / exports / wipes. */
export const USER_DATA_TABLES = [
  'listings',
  'orders',
  'chats',
  'messages',
  'reviews',
  'financeOps',
  'balances',
  'customers',
  'inventoryPools',
  'deliveries',
  'competitorSnapshots',
  'priceRules',
  'templates',
  'autoReplyRules',
  'reviewTemplates',
  'workflowRules',
  'notifications',
  'drafts',
  'bumpState',
] as const;
