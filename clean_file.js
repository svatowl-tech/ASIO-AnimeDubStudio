const fs = require('fs');
let beContent = fs.readFileSync('src/components/BackstageEditor.tsx', 'utf8');

const hcEnd = beContent.indexOf('ks } from "../hooks/backstage/useBackstageBlocks";');
const returnStart = beContent.indexOf('  return (\n    <div className="fixed inset-0');

if (hcEnd !== -1 && returnStart !== -1) {
  beContent = beContent.substring(0, hcEnd) + beContent.substring(returnStart);
  fs.writeFileSync('src/components/BackstageEditor.tsx', beContent);
} else {
  console.log("Could not find markers!");
}
