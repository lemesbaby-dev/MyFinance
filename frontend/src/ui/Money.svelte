<script>
  import { moneyText } from './money.js';
  // kind: income | expense | transfer | forecast | overdue | neutral. size: lg | md | sm.
  let { cents, kind = 'neutral', size = 'sm', signed = true } = $props();
</script>

<span class="ui-money {kind} {size}">{moneyText(cents, kind, signed)}</span>

<style>
  .ui-money { font-variant-numeric: var(--num-features); letter-spacing: var(--ls-tight); white-space: nowrap; color: var(--text-strong); }
  .lg { font: var(--money-lg-weight) var(--money-lg-size)/var(--money-lg-lh) var(--money-lg-font); }
  .md { font: var(--money-md-weight) var(--money-md-size)/var(--money-md-lh) var(--money-md-font); }
  .sm { font: var(--money-sm-weight) var(--money-sm-size)/var(--money-sm-lh) var(--money-sm-font); }
  .income { color: var(--color-income); } .expense { color: var(--color-expense); } .transfer { color: var(--color-transfer); }
  .forecast { color: var(--color-forecast); } .overdue { color: var(--color-overdue); }
</style>
