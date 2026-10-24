@'
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.css";
'@ | Set-Content .\src\styles.d.ts