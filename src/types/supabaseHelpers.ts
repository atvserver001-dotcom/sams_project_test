import type { Database } from '@/types/database.types'

export type PublicSchema = Database['public']
export type PublicTables = PublicSchema['Tables']
export type TableName = keyof PublicTables

export type TableRow<T extends TableName> = PublicTables[T]['Row']
export type TableInsert<T extends TableName> = PublicTables[T]['Insert']
export type TableUpdate<T extends TableName> = PublicTables[T]['Update']


