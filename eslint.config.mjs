import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const nextRootDir = import.meta.dirname;
const eslintConfig = [
    {
        settings: {
            next: {
                rootDir: nextRootDir
            }
        }
    },
    ...nextVitals,
    ...nextTypescript
];

export default eslintConfig;
