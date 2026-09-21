/**
 * Augment Astro JSX types so that `use:form` (progressive enhancement directive)
 * is accepted on <form> elements without TS errors.
 *
 * Astro 7 emits `use:form` correctly at build time, but the shipped JSX types
 * do not declare the `use` property on FormHTMLAttributes.
 */
declare namespace astroHTML.JSX {
  interface FormHTMLAttributes {
    'use:form'?: boolean;
  }
}
