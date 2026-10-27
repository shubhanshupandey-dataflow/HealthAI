import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Share2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { del, errorMessage, get, post } from '../lib/api'
import { fmtDateTime } from '../lib/format'
import type { ShareLink } from '../lib/types'
import { Button, buttonClass, ConfirmButton, Field, Input, Modal } from './ui'

const DEFAULT_HOURS = 6
const MAX_HOURS = 720

const linkUrl = (link: ShareLink) => `${window.location.origin}${link.path}`

/** Sidebar button: makes a public link so others can try the assistant without signing in. */
export function ShareAssistantButton({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} className={buttonClass('secondary', 'sm', 'w-full')}>
        <Share2 className="size-4" /> Share {name} for testing
      </button>
      {open && <ShareAssistantModal name={name} onClose={() => setOpen(false)} />}
    </>
  )
}

function ShareAssistantModal({ name, onClose }: { name: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: links = [] } = useQuery({ queryKey: ['share-links'], queryFn: () => get<ShareLink[]>('/share-links') })
  const [hours, setHours] = useState(String(DEFAULT_HOURS))
  const [created, setCreated] = useState<ShareLink | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const value = Number(hours)
  const valid = hours.trim() !== '' && value > 0 && value <= MAX_HOURS

  async function create() {
    if (!valid) return
    setSaving(true)
    setError('')
    try {
      setCreated(await post<ShareLink>('/share-links', { hours: value }))
      qc.invalidateQueries({ queryKey: ['share-links'] })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function stop(link: ShareLink) {
    try {
      await del(`/share-links/${link.id}`)
      toast.success('Link stopped - it no longer works')
      if (created?.id === link.id) setCreated(null)
      qc.invalidateQueries({ queryKey: ['share-links'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const others = links.filter((l) => l.id !== created?.id)

  return (
    <Modal
      open
      onClose={onClose}
      title={`Share ${name} for testing`}
      description={`Anyone with the link can call ${name} from their browser without signing in, until it expires. They call as a new caller and verify themselves with their name and date of birth.`}
      footer={
        created ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={create} loading={saving} disabled={!valid}>
              OK
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Public link</p>
          <LinkRow link={created} />
          <p className="text-xs text-slate-500">Expires {fmtDateTime(created.expires_at)}.</p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            create()
          }}
        >
          <Field label="Link expires after (hours)" hint={`Default ${DEFAULT_HOURS} hours, up to ${MAX_HOURS} (30 days).`}>
            <Input
              type="number"
              min={1}
              max={MAX_HOURS}
              step={1}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              autoFocus
            />
          </Field>
        </form>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {others.length > 0 && (
        <div className="mt-6 border-t border-slate-100 pt-4">
          <p className="text-sm font-medium text-slate-700">Other active links</p>
          <ul className="mt-2 space-y-3">
            {others.map((link) => (
              <li key={link.id} className="space-y-1">
                <LinkRow link={link} onStop={() => stop(link)} />
                <p className="text-xs text-slate-500">
                  Expires {fmtDateTime(link.expires_at)} · made by {link.created_by}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}

function LinkRow({ link, onStop }: { link: ShareLink; onStop?: () => void }) {
  const [copied, setCopied] = useState(false)
  const url = linkUrl(link)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy - select the link and copy it yourself')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={url} onFocus={(e) => e.target.select()} className="h-9 min-w-0 flex-1 font-mono text-xs" />
      <Button size="sm" variant="secondary" onClick={copy} icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
      {onStop && <ConfirmButton onConfirm={onStop}>Stop</ConfirmButton>}
    </div>
  )
}
