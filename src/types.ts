export type Article = {
  id: string;
  company: string;
  title: string;
  url: string;
  date: string;
  excerpt: string;
  readMins?: number;
  hnPoints?: number;
  short?: { tldr: string[]; idea: string; tags: string[]; model: string; v: number; thin?: boolean; tries?: number };
};
