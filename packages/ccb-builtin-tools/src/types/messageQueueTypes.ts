// Auto-generated stub â€?replace with real implementation
export type QueueOperationMessage = {
  type: 'queue-operation'
  operation: QueueOperation
  timestamp: string
  sessionId: string
  content?: string
  [key: string]: unknown
}
export type QueueOperation = 'enqueue' | 'dequeue' | 'remove' | string

