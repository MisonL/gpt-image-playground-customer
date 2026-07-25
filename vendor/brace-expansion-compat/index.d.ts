export type BraceExpansionOptions = {
    max?: number;
    maxLength?: number;
};

export declare const EXPANSION_MAX: number;
export declare const EXPANSION_MAX_LENGTH: number;
export declare function expand(str: string, options?: BraceExpansionOptions): string[];
export default expand;
