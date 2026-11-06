import { CatalogQuery, QueryCancelled, type LibraryFilter } from './query';
const scope = self as unknown as { onmessage: (event: MessageEvent<{ id: number; filter: LibraryFilter }>) => void; postMessage: (message: unknown) => void };
let latest = 0; const engine = new CatalogQuery();
scope.onmessage = event => {
  const { id, filter } = event.data; latest = id;
  void engine.run(filter, undefined, () => id !== latest).then(result => { if (id === latest) scope.postMessage({ id, result }); }).catch(error => {
    if (id !== latest) return;
    scope.postMessage({ id, retry: error instanceof QueryCancelled, error: error instanceof QueryCancelled ? undefined : '本地笔记读取失败，请刷新后重试。原有数据未删除。' });
  });
};
