/**
 * One list expanded: colored header, grid of covers, "+" opens a picker that
 * filters the user's library; items are added/removed with a tap.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Check, Plus, Search, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import PosterCard from '../components/PosterCard'
import { db, deleteList, rewatchGrades, toggleListItem } from '../db'
import { useT } from '../i18n'

export default function ListDetailPage() {
  const { id } = useParams() as { id: string }
  const t = useT()
  const nav = useNavigate()
  const [picking, setPicking] = useState(false)
  const [filter, setFilter] = useState('')
  const list = useLiveQuery(() => db.lists.get(id), [id])
  const items = useLiveQuery(() => db.items.toArray(), [])
  const eps = useLiveQuery(() => db.episodes.toArray(), [])

  if (!list || !items || !eps) return null
  const grades = rewatchGrades(items, eps)
  const byId = new Map(items.map((i) => [i.id, i]))
  const inList = list.itemIds.map((x) => byId.get(x)).filter(Boolean)
  const pickPool = items
    .filter((i) => i.title.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => b.addedAt - a.addedAt)

  return (
    <div className="pb-8">
      <header
        className="flex items-center gap-3 px-4 pb-4 pt-safe"
        style={{ background: `linear-gradient(180deg, ${list.color}33, transparent)` }}
      >
        <button
          onClick={() => nav(-1)}
          aria-label="back"
          className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="flex-1 truncate text-2xl font-extrabold tracking-tight" style={{ color: list.color }}>
          {list.name}
        </h1>
        <button
          onClick={async () => {
            if (confirm(t('lists.deleteConfirm'))) {
              await deleteList(id)
              nav('/lists')
            }
          }}
          aria-label="delete list"
          className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink3 transition-colors hover:border-red-500 hover:text-red-400"
        >
          <Trash2 size={16} />
        </button>
        <button
          onClick={() => setPicking(true)}
          aria-label={t('lists.add')}
          className="grid h-10 w-10 place-items-center rounded-full text-black transition-transform active:scale-90"
          style={{ background: list.color }}
        >
          <Plus size={18} strokeWidth={3} />
        </button>
      </header>

      {inList.length === 0 ? (
        <button onClick={() => setPicking(true)} className="block w-full text-left">
          <EmptyState icon={<Plus size={32} />} text={t('lists.emptyList')} />
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-4 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {inList.map(
            (i) =>
              i && (
                <div key={i.id} className="relative">
                  <PosterCard
                    className="w-auto"
                    title={i.title}
                    poster={i.poster}
                    year={i.year}
                    rating={i.rating}
                    statusKind={i.status === 'completed' ? 'done' : i.status === 'watching' ? 'ongoing' : null}
                    rewatchCount={grades.get(i.id)}
                    onClick={() => nav(`/media/${i.provider}/${i.mediaType}/${i.providerId}`)}
                  />
                  <button
                    aria-label="remove from list"
                    onClick={() => toggleListItem(id, i.id)}
                    className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white backdrop-blur transition-colors hover:bg-red-600"
                  >
                    <X size={13} strokeWidth={3} />
                  </button>
                </div>
              ),
          )}
        </div>
      )}

      {/* library picker */}
      {picking && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/60" onClick={() => setPicking(false)}>
          <div
            className="fade-up mt-auto flex max-h-[80vh] flex-col rounded-t-3xl border border-line bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 pb-2">
              <div className="mb-3 text-center text-sm font-bold">{t('lists.pickerTitle')}</div>
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink3" />
                <input
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t('lists.pickerFilter')}
                  className="w-full rounded-full border border-line bg-surface py-2.5 pl-10 pr-4 text-sm outline-none focus:border-accent"
                />
              </div>
            </div>
            <div className="pb-safe-sheet min-h-0 flex-1 overflow-y-auto px-4">
              {pickPool.map((i) => {
                const included = list.itemIds.includes(i.id)
                return (
                  <button
                    key={i.id}
                    onClick={() => toggleListItem(id, i.id)}
                    className="flex w-full items-center gap-3 border-b border-line/50 py-2 text-left last:border-b-0"
                  >
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-card2">
                      {i.poster && <img src={i.poster} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{i.title}</span>
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2"
                      style={
                        included
                          ? { background: list.color, borderColor: list.color, color: '#000' }
                          : { borderColor: 'var(--line)', color: 'var(--ink3)' }
                      }
                    >
                      {included ? <Check size={13} strokeWidth={3} /> : <Plus size={13} strokeWidth={3} />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
