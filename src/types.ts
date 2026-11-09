export type Article = {
  id: string;
  company: string;
  title: string;
  url: string;
  date: string;
  excerpt: string;
  readMins?: number;
  hnPoints?: number;
};
