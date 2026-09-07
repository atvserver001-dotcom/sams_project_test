import { handlePreviewRequest } from '../../../api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = handlePreviewRequest
export const POST = handlePreviewRequest
export const PATCH = handlePreviewRequest
export const DELETE = handlePreviewRequest
export const PUT = handlePreviewRequest
export const HEAD = handlePreviewRequest
export const OPTIONS = handlePreviewRequest
