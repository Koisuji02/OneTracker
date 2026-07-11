/**
 * All user lists, stacked. Each list is a colored box with a horizontally
 * scrollable preview and a chevron opening its detail page. New lists are
 * created inline (name + color swatch).
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ChevronRight, ListVideo, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import EmptyState from '../components/EmptyState'
import { createList, db, LIST_COLORS } from '../db'
import { useT } from '../i18n'
import { cn } from '../util'

export default function ListsPage() {
  const t = useT()
  const nav = useNavigate()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(LIST_COLORS[0])
  const lists = useLiveQuery(() => db.lists.orderBy('createdAt').toArray(), [])
  const items = useLiveQuery(() => db.items.toArray(), [])

  if (!lists || !items) return null
  const byId = new Map(items.map((i) => [i.id, i]))

  const submit = async () => {
    if (!name.trim()) return
    const list = await createList(name, color)
    setName('')
    setCreating(false)
    nav(`/lists/${list.id}`)
  }

  return (
    <div className="pb-8">
      <header className="flex items-center gap-3 px-4 pb-4 pt-6">
        <button
          onClick={() => nav(-1)}
          aria-label="back"
          className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink2 transition-colors hover:border-accent hover:text-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="flex-1 text-2xl font-extrabold tracking-tight">{t('lists.title')}</h1>
        <button
          onClick={() => setCreating(!creating)}
          aria-label={t('lists.new')}
          className="grid h-10 w-10 place-items-center rounded-full bg-brand text-black transition-transform active:scale-90"
        >
          <Plus size={18} strokeWidth={3} />
        </button>
      </header>

      {creating && (
        <div className="fade-up mx-4 mb-4 rounded-2xl border border-line bg-card p-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={t('lists.name')}
            maxLength={40}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none transition-colors focus:border-accent"
          />
          <div className="mt-3 flex items-center gap-2">
            {LIST_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`color ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  'h-7 w-7 rounded-full transition-transform',
                  color === c && 'scale-110 ring-2 ring-white/70',
                )}
                style={{ background: c }}
              />
            ))}
            <button
              onClick={submit}
              className="ml-auto rounded-full bg-brand px-4 py-2 text-xs font-bold text-black"
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      )}

      {lists.length === 0 && !creating ? (
        <EmptyState icon={<ListVideo size={32} />} text={t('lists.empty')} />
      ) : (
        <div className="space-y-4 px-4">
          {lists.map((list) => {
            const previews = list.itemIds
              .map((id) => byId.get(id))
              .filter(Boolean)
              .slice(0, 12)
            return (
              <div
                key={list.id}
                className="rounded-2xl border p-4"
                style={{ background: `${list.color}1f`, borderColor: `${list.color}66` }}
              >
                <Link to={`/lists/${list.id}`} className="flex items-center gap-2">
                  <span className="flex-1 truncate font-bold" style={{ color: list.color }}>
                    {list.name}
                  </span>
                  <span className="text-xs text-ink3">
                    {list.itemIds.length} {t('lists.items')}
                  </span>
                  <ChevronRight size={18} className="text-ink3" />
                </Link>
                {previews.length > 0 && (
                  <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
                    {previews.map(
                      (i) =>
                        i && (
                          <div
                            key={i.id}
                            onClick={() => nav(`/media/${i.provider}/${i.mediaType}/${i.providerId}`)}
                            className="h-24 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg bg-card2"
                          >
                            {i.poster && (
                              <img src={i.poster} alt={i.title} className="h-full w-full object-cover" />
                            )}
                          </div>
                        ),
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
