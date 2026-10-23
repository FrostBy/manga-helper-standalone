/**
 * AllHentai API — the ReadManga engine on a network of its own: own catalog,
 * API host (z.qawa.org, named by its pages) and sign-in.
 */
import { ReadMangaAPI } from './readmanga';

export const allhentaiAPI = new ReadMangaAPI({
  key: 'allhentai',
  title: 'AllHentai',
  domains: ['allhen.online', 'allhentai.ru'],
  pools: { manga: { id: 'allhentai:manga', hosts: ['https://20.allhen.online'] } },
  chainOrder: ['manga'],
  groups: { manga: 'AllHentai' },
});
