import { db, type IdeaClipDB } from '../storage';
import { normalize, searchOf, type NoteCard } from './projections';

export interface LibraryFilter {
  query: string; scope: 'all' | 'title' | 'content' | 'body' | 'tags' | 'author';
  state: 'saved' | 'draft' | 'all'; site: string | null; category: string | null;
  favorite: 'all' | 'yes' | 'no'; from: number | null; to: number | null;
  sort: 'newest' | 'oldest' | 'modified'; page: number;
}
export const PAGE_SIZE = 24;
export const initialFilter: LibraryFilter = { query: '', scope: 'all', state: 'saved', site: null, category: null, favorite: 'all', from: null, to: null, sort: 'newest', page: 0 };
export interface QueryResult { rows: NoteCard[]; total: number; sites: string[]; categories: string[]; saved: number; drafts: number; revision: number }
export class QueryCancelled extends Error {}
export class CatalogQuery {
  private cache: { revision: number; rows: NoteCard[] } | null = null;
  async run(filter: LibraryFilter, database: IdeaClipDB = db, cancelled = () => false): Promise<QueryResult> {
    const check = () => { if (cancelled()) throw new QueryCancelled(); };
    const revision = (await database.libraryState.get('notes'))?.revision ?? 0;
    if (!this.cache || this.cache.revision !== revision) {
      const rows: NoteCard[] = []; let last: string | undefined;
      for (;;) {
        check(); const chunk = await (last ? database.noteCatalog.where('id').above(last) : database.noteCatalog.toCollection()).limit(256).toArray();
        if (!chunk.length) break; rows.push(...chunk); last = chunk.at(-1)!.id;
      }
      check(); this.cache = { revision, rows };
    }
    const rows = this.cache.rows;
    let matches = rows.filter(row => (filter.state === 'all' || row.saveState === filter.state) && (filter.site === null || row.site === filter.site) && (filter.category === null || row.category === filter.category) && (filter.favorite === 'all' || row.favorite === (filter.favorite === 'yes')) && (filter.from === null || row.createdAt >= filter.from) && (filter.to === null || row.createdAt <= filter.to));
    const terms = normalize(filter.query.trim()).split(/\s+/).filter(Boolean);
    if (terms.length) {
      const found: NoteCard[] = [];
      for (let offset = 0; offset < matches.length; offset += 64) {
        check(); const batch = matches.slice(offset, offset + 64); const texts = await database.noteSearch.bulkGet(batch.map(row => row.id));
        for (let index = 0; index < batch.length; index++) {
          let record = texts[index];
          if (!record) { const note = await database.notes.get(batch[index].id); if (note) record = searchOf(note); }
          if (!record) continue;
          const text = filter.scope === 'all' ? [record.title, record.content, record.body, record.tags, record.author].join('\n') : record[filter.scope];
          if (terms.every(term => text.includes(term))) found.push(batch[index]);
        }
      }
      matches = found;
    }
    check();
    const key = filter.sort === 'modified' ? 'updatedAt' : 'createdAt'; const direction = filter.sort === 'oldest' ? 1 : -1;
    matches.sort((a, b) => direction * (a[key] - b[key] || a.id.localeCompare(b.id)));
    if (((await database.libraryState.get('notes'))?.revision ?? 0) !== revision) { this.cache = null; throw new QueryCancelled(); }
    return { rows: matches.slice(filter.page * PAGE_SIZE, (filter.page + 1) * PAGE_SIZE), total: matches.length, sites: [...new Set(rows.map(row => row.site))].sort(), categories: [...new Set(rows.map(row => row.category))].sort((a, b) => a.localeCompare(b, 'zh-CN')), saved: rows.filter(row => row.saveState === 'saved').length, drafts: rows.filter(row => row.saveState === 'draft').length, revision };
  }
}
export function dayBoundary(value: string, end = false): number | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效日期。');
  const [year, month, day] = value.split('-').map(Number);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) throw new Error('请选择有效日期。');
  if (end) { date.setDate(date.getDate() + 1); return date.getTime() - 1; }
  return date.getTime();
}
