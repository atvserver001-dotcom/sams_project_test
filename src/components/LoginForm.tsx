'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  ArrowUpRight,
  AlertCircle,
  LoaderCircle,
  ArrowRight,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
const schema = z.object({
  username: z.string().min(1, '아이디를 입력해주세요.'),
  password: z.string().min(1, '비밀번호를 입력해주세요.'),
})
type Credentials = z.infer<typeof schema>
export default function LoginForm() {
  const { signIn } = useAuth()
  const router = useRouter()
  const [error, setError] = useState('')
  const [remember, setRemember] = useState(false)
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Credentials>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  })
  useEffect(() => {
    try {
      const saved = localStorage.getItem('saved_username')
      if (saved) {
        setValue('username', saved)
        setRemember(true)
      }
    } catch {
      /* Browser storage can be disabled independently of sign-in. */
    }
  }, [setValue])
  const submit = async ({ username, password }: Credentials) => {
    setError('')
    try {
      const result = await signIn(username, password)
      if (result.error) {
        setError(result.error)
        return
      }
      try {
        if (remember) localStorage.setItem('saved_username', username)
        else localStorage.removeItem('saved_username')
      } catch {
        /* A successful sign-in must not depend on browser storage. */
      }
      if (result.user?.role === 'admin') router.replace('/admin')
      else if (result.user?.role === 'school') router.replace('/school')
    } catch {
      setError('오류가 발생했습니다. 다시 시도해주세요.')
    }
  }
  return (
    <main className="login-page">
      <section className="login-form-panel">
        <Image
          src="/image/logo_atvcms.svg"
          width={155}
          height={30}
          className="h-[30px] w-auto self-start object-contain"
          priority
          alt="atvcms"
        />
        <div className="mb-auto w-full max-w-[420px] pb-16 pt-10">
          <p className="mb-3 text-[11px] font-bold text-primary">
            SCHOOL EXERCISE RECORDS
          </p>
          <h1 className="text-[34px] font-extrabold leading-[1.14]">
            학교 운동 관리 시스템
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            학교 계정 또는 관리자 계정으로 로그인하세요.
          </p>
          <form
            className="mt-9 space-y-[18px]"
            onSubmit={handleSubmit(submit)}
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="username">아이디</Label>
              <Input
                id="username"
                autoComplete="username"
                placeholder="아이디를 입력하세요"
                className="h-12 bg-background px-4 text-[15px]"
                aria-invalid={!!errors.username}
                aria-describedby={
                  errors.username ? 'username-error' : undefined
                }
                {...register('username')}
              />
              {errors.username && (
                <p id="username-error" className="text-xs text-destructive">
                  {errors.username.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="비밀번호를 입력하세요"
                className="h-12 bg-background px-4 text-[15px]"
                aria-invalid={!!errors.password}
                aria-describedby={
                  errors.password ? 'password-error' : undefined
                }
                {...register('password')}
              />
              {errors.password && (
                <p id="password-error" className="text-xs text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2.5 py-1">
              <Checkbox
                id="remember"
                checked={remember}
                onCheckedChange={(value) => setRemember(value === true)}
              />
              <Label htmlFor="remember" className="font-normal">
                아이디 기억하기
              </Label>
            </div>
            {error && (
              <div
                role="alert"
                className="flex gap-3 border-l-[3px] border-destructive bg-accent p-4 text-[13px] text-accent-foreground"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            )}
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-12 w-full justify-start px-4 text-[15px] font-bold"
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle className="animate-spin" /> 로그인 중...
                </>
              ) : (
                <>
                  로그인 <ArrowRight className="ml-auto" />
                </>
              )}
            </Button>
          </form>
        </div>
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© AllThatVision. All rights reserved.</span>
          <a
            href="https://spopark.kr/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-foreground"
          >
            spopark.kr <ArrowUpRight className="size-[13px]" />
          </a>
        </footer>
      </section>
      <section className="login-poster" aria-label="학생 운동 기록">
        <p className="text-[11px] font-bold text-white/80">
          ALL THAT VISION · SCHOOL ACTIVITY MANAGEMENT
        </p>
        <h2 className="mb-auto mt-[108px] pb-16">
          운동기록,
          <br />
          학급 단위로
          <br />
          한눈에.
        </h2>
        <div className="grid grid-cols-3 border-t-2 border-white/65">
          {[
            ['PAPS', '학생 건강체력 평가'],
            ['Heart Care', '실시간 심박 기록'],
            ['Health Care', '꾸준한 운동 관리'],
          ].map(([title, detail], i) => (
            <div
              key={title}
              className={
                'px-4 py-[18px]' + (i ? ' border-l-2 border-white/65' : ' pl-0')
              }
            >
              <p className="text-[24px] font-extrabold leading-tight">
                {title}
              </p>
              <p className="mt-2 text-xs text-white/80">{detail}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
