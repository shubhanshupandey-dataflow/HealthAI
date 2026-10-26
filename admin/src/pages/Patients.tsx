import { useQuery } from '@tanstack/react-query'
import { Search, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PatientFormModal } from '../components/PatientForm'
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  SourceBadge,
  Table,
  Td,
  Th,
} from '../components/ui'
import { errorMessage, get } from '../lib/api'
import { age, fmtDate, fmtDateShort, fmtDateTime } from '../lib/format'
import { useDebounced } from '../lib/hooks'
import type { Paged, Patient } from '../lib/types'

const PAGE_SIZE = 25

export default function Patients() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const search = useDebounced(q)

  const { data, isLoading, error } = useQuery({
    queryKey: ['patients', search, page],
    queryFn: () => get<Paged<Patient>>('/patients', { search, page, page_size: PAGE_SIZE }),
  })

  return (
    <>
      <PageHeader
        title="Patients"
        description="Everyone registered with the clinic, including patients the AI receptionist signed up."
        actions={
          <Button icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
            Add patient
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Search by name, phone or email"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
          </div>
          {data && <span className="text-sm text-slate-500">{data.total} patients</span>}
        </div>
        {isLoading ? (
          <LoadingBlock />
        ) : error ? (
          <div className="p-4">
            <ErrorBlock message={errorMessage(error)} />
          </div>
        ) : !data?.items.length ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={search ? `No patients match "${search}"` : 'No patients yet'}
            action={
              <Button variant="secondary" onClick={() => setAdding(true)}>
                Add patient
              </Button>
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Patient</Th>
                  <Th>Phone</Th>
                  <Th>Date of birth</Th>
                  <Th>Next appointment</Th>
                  <Th>Last visit</Th>
                  <Th>Registered</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/patients/${p.id}`)}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={p.full_name} color="#1b5e96" size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{p.full_name}</p>
                          <p className="truncate text-xs text-slate-500">{p.email || '—'}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-slate-700 tabular-nums">{p.phone || '—'}</Td>
                    <Td className="text-slate-700">
                      {p.date_of_birth ? (
                        <>
                          {fmtDateShort(p.date_of_birth)} {p.date_of_birth.slice(0, 4)}
                          <span className="text-slate-400"> · {age(p.date_of_birth)}y</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      {p.next_appointment ? (
                        <span className="font-medium text-teal-700">{fmtDateTime(p.next_appointment)}</span>
                      ) : (
                        <span className="text-slate-400">None</span>
                      )}
                    </Td>
                    <Td className="text-slate-700">{p.last_visit ? fmtDate(p.last_visit) : <span className="text-slate-400">—</span>}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">{fmtDateShort(p.created_at)}</span>
                        {p.source === 'ai_agent' && <SourceBadge source="ai_agent" />}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {adding && <PatientFormModal onClose={() => setAdding(false)} onSaved={(p) => navigate(`/patients/${p.id}`)} />}
    </>
  )
}
