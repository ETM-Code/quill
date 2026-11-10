// Stand-in for the bare `katex` import inside @tiptap/extension-mathematics
// (see vite.config.ts): same `katex.render(latex, el, options)` surface, but
// the engine is loaded on demand by ./math-render.
import { renderMath } from './math-render'
export default { render: renderMath }
