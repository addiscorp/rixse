export interface Zega {
  run(zql: string): unknown[];
  schema: string;
  loadMs: number;
}
export declare function getZega(): Zega | null;
export declare function loadZega(base?: string): Promise<Zega>;
