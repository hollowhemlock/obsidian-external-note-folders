export const LEAF_REPORT_CSS = `
.exnf-leaf-report{container-type:inline-size;font:14px/1.5 system-ui,sans-serif;color:var(--text-normal,#233042);background:var(--background-primary,#f6f8fb);padding:24px;min-height:100%;box-sizing:border-box}
.exnf-leaf-report *{box-sizing:border-box}
.exnf-leaf-report [hidden]{display:none!important}
.exnf-leaf-report h1{font-size:28px;margin:0 0 8px;letter-spacing:-.5px}
.exnf-leaf-report h2{font-size:17px;margin:8px 0;overflow-wrap:anywhere}
.exnf-leaf-report p{margin:8px 0}
.exnf-leaf-report .leaf-context{white-space:pre-wrap;font-size:12px;color:var(--text-muted,#58677b);overflow-wrap:anywhere}
.exnf-leaf-report .leaf-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:18px 0}
.exnf-leaf-report input,.exnf-leaf-report select,.exnf-leaf-report button{font:inherit;padding:7px 10px;border:1px solid var(--background-modifier-border,#bdc8d7);border-radius:6px;background:var(--background-secondary,#fff);color:inherit;height:auto}
.exnf-leaf-report input[type=search]{flex:1;min-width:220px}
.exnf-leaf-report button{cursor:pointer;white-space:normal}
.exnf-leaf-report button:disabled{opacity:.45;cursor:default}
.exnf-leaf-report button[aria-expanded=true]{background:var(--background-modifier-hover,#e5edf9)}
.exnf-leaf-report :focus-visible{outline:3px solid #5b8fd6;outline-offset:2px}
.exnf-leaf-report .leaf-stats{padding:14px 18px;border-left:4px solid #427abe;background:var(--background-secondary,#eaf0f8);border-radius:6px;font-size:16px}
.exnf-leaf-report .leaf-warning{background:var(--background-secondary,#fff2d4);border-left:4px solid #bb842a;padding:10px 14px;margin:12px 0}
.exnf-leaf-report .leaf-row{padding:12px 0;border-top:1px solid var(--background-modifier-border,#e1e7ef);overflow-wrap:anywhere}
.exnf-leaf-report summary{cursor:pointer;font-weight:600}
.exnf-leaf-report .leaf-tags{font-size:12px;color:var(--text-muted,#58677b);margin:4px 0}
.exnf-leaf-report .leaf-note{margin:6px 0;padding:5px 9px;background:var(--background-primary,#f6f8fb);border-radius:4px}
.exnf-leaf-report .leaf-status{min-height:24px;font-size:13px}
.exnf-leaf-report a{color:var(--text-accent,#245f9e)}
.exnf-leaf-report .leaf-layout{display:grid;grid-template-columns:minmax(0,3fr) minmax(260px,2fr);gap:18px}
.exnf-leaf-report .leaf-tree{height:60vh;min-height:260px;overflow:auto;position:relative;border:1px solid var(--background-modifier-border,#bdc8d7);border-radius:6px;background:var(--background-secondary,#fff)}
.exnf-leaf-report .leaf-tree-space{position:relative;min-width:100%}
.exnf-leaf-report .leaf-tree-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.exnf-leaf-report .leaf-tree-item{display:flex;align-items:center;position:absolute;left:0;right:0;height:36px;line-height:36px;padding-right:8px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;cursor:pointer}
.exnf-leaf-report .leaf-tree-item[aria-selected=true]{background:var(--background-modifier-hover,#e5edf9);font-weight:600}
.exnf-leaf-report .leaf-tree-item[data-tone=note]{border-right:4px solid var(--color-blue,#2867ac)}
.exnf-leaf-report .leaf-tree-item[data-tone=unchecked]{border-right:4px solid var(--color-yellow,#986600)}
.exnf-leaf-report .leaf-tree-item[data-tone=adopted]{border-right:4px solid var(--color-green,#27834b)}
.exnf-leaf-report .leaf-tree-item[data-tone=conflict]{border-right:4px solid var(--color-red,#b62d38)}
.exnf-leaf-report .leaf-details{min-width:0;overflow-wrap:anywhere;max-height:60vh;overflow:auto;padding:12px;border:1px solid var(--background-modifier-border,#bdc8d7);border-radius:6px}
.exnf-leaf-report .leaf-evidence{flex-shrink:0;min-width:62px;text-align:center;font-size:12px;line-height:18px;margin-left:6px;padding:2px 5px;border:1px solid var(--background-modifier-border,#bdc8d7);border-radius:4px}
.exnf-leaf-report .leaf-evidence-absent,.exnf-leaf-report .leaf-evidence-unchecked{color:var(--text-muted,#58677b)}
.exnf-leaf-report .leaf-evidence-invalid{color:var(--text-warning,#936000);font-weight:600}
.exnf-leaf-report .leaf-tree-item[data-tone=marker] .leaf-tree-label{font-weight:650}
.exnf-leaf-report .leaf-inherited{flex-shrink:0;margin-left:6px;color:var(--text-muted,#58677b)}
.exnf-leaf-report .leaf-disclosure{margin:10px 0}
.exnf-leaf-report .leaf-disclosure>summary{padding:6px 0}
.exnf-leaf-report .leaf-toolbar>.leaf-disclosure{position:relative;margin:0}
.exnf-leaf-report .leaf-toolbar>.leaf-disclosure>summary{padding:7px 12px;border:1px solid var(--background-modifier-border,#bdc8d7);border-radius:6px}
.exnf-leaf-report .leaf-toolbar>.leaf-disclosure>.leaf-toolbar{position:absolute;top:100%;right:0;z-index:5;width:min(440px,75vw);padding:14px;margin:4px 0;box-shadow:0 4px 16px #0003;border:1px solid var(--background-modifier-border,#bdc8d7);border-radius:6px;background:var(--background-primary,#f6f8fb)}
.exnf-leaf-report .leaf-active-filters{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:13px;margin-bottom:12px}
.exnf-leaf-report .leaf-relationship{border-left:3px solid var(--text-muted,#58677b);padding:0 12px;margin:16px 0}
.exnf-leaf-report .leaf-details h3{font-size:15px;margin:12px 0 6px}
.exnf-leaf-report .leaf-details button{margin:3px}
.exnf-leaf-report .leaf-legend{font-size:12px;color:var(--text-muted,#58677b)}
@media(prefers-color-scheme:dark){.exnf-leaf-report{color:var(--text-normal,#e2e8f0);background:var(--background-primary,#20252c)}.exnf-leaf-report .leaf-stats,.exnf-leaf-report .leaf-warning,.exnf-leaf-report .leaf-note,.exnf-leaf-report .leaf-tree,.exnf-leaf-report button,.exnf-leaf-report input,.exnf-leaf-report select{background:var(--background-secondary,#282f39)}.exnf-leaf-report .leaf-tree-item[aria-selected=true]{background:var(--background-modifier-hover,#354860)}.exnf-leaf-report .leaf-context,.exnf-leaf-report .leaf-tags,.exnf-leaf-report .leaf-legend{color:var(--text-muted,#b6c2d2)}}
@container(max-width:800px){.exnf-leaf-report .leaf-layout{grid-template-columns:minmax(0,1fr)}.exnf-leaf-report .leaf-details{max-height:none}}
@container(max-width:800px){.exnf-leaf-report .leaf-toolbar:has(>.leaf-disclosure){position:relative}.exnf-leaf-report .leaf-toolbar>.leaf-disclosure{position:static}.exnf-leaf-report .leaf-toolbar>.leaf-disclosure>.leaf-toolbar{left:0;right:0;width:100%}}
@media(prefers-color-scheme:dark){.exnf-leaf-report .leaf-evidence-absent,.exnf-leaf-report .leaf-evidence-unchecked,.exnf-leaf-report .leaf-inherited{color:var(--text-muted,#b6c2d2)}.exnf-leaf-report .leaf-evidence-invalid{color:var(--text-warning,#f2c66d)}.exnf-leaf-report .leaf-toolbar>.leaf-disclosure>.leaf-toolbar{background:var(--background-primary,#20252c)}}
@media(max-width:600px){.exnf-leaf-report{padding:14px}.exnf-leaf-report h1{font-size:23px}.exnf-leaf-report .leaf-toolbar{align-items:stretch}.exnf-leaf-report .leaf-toolbar>*{max-width:100%}}
`;
