import { handleAdminPreviewRequest } from '../../../api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = handleAdminPreviewRequest
export const POST = handleAdminPreviewRequest
export const PATCH = handleAdminPreviewRequest
export const DELETE = handleAdminPreviewRequest
export const PUT = handleAdminPreviewRequest
export const HEAD = handleAdminPreviewRequest
export const OPTIONS = handleAdminPreviewRequest
