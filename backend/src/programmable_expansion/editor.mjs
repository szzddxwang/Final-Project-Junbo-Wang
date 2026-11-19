import {EditorView,lineNumbers,highlightActiveLine,drawSelection,keymap}from'../../tools/programmable_simulator/node_modules/@codemirror/view/dist/index.js';
import {EditorState}from'../../tools/programmable_simulator/node_modules/@codemirror/state/dist/index.js';
import {defaultKeymap,history,historyKeymap,indentWithTab}from'../../tools/programmable_simulator/node_modules/@codemirror/commands/dist/index.js';
import {syntaxHighlighting,defaultHighlightStyle,bracketMatching,indentOnInput}from'../../tools/programmable_simulator/node_modules/@codemirror/language/dist/index.js';
import {cpp}from'../../tools/programmable_simulator/node_modules/@codemirror/lang-cpp/dist/index.js';
import {python}from'../../tools/programmable_simulator/node_modules/@codemirror/lang-python/dist/index.js';
export function editor(parent,source,language,onChange,readOnly=false){return new EditorView({parent,state:EditorState.create({doc:source,extensions:[EditorState.readOnly.of(readOnly),EditorView.editable.of(!readOnly),lineNumbers(),highlightActiveLine(),drawSelection(),history(),keymap.of([indentWithTab,...defaultKeymap,...historyKeymap]),syntaxHighlighting(defaultHighlightStyle),bracketMatching(),indentOnInput(),language==='arduino'?cpp():python(),EditorView.lineWrapping,EditorView.updateListener.of(u=>{if(u.docChanged)onChange(u.state.doc.toString());}),EditorView.contentAttributes.of({'aria-label':'Firmware source editor'}),EditorView.theme({'&':{height:'420px',border:'1px solid #cfdbe3',fontSize:'14px',background:'#fff'},'.cm-scroller':{overflow:'auto',fontFamily:'Consolas, monospace',lineHeight:'1.6'},'.cm-content':{padding:'12px 0'},'.cm-gutters':{background:'#f5f8fa',color:'#536575',border:'none'}})]})});}
export * from './graph.mjs';
export * from './comparison.mjs';
export {importLegacy}from './legacy.mjs';

export * from './canvas_geometry.mjs';
export * from './experiments.mjs';
export {calibrateTwoPoint} from './physics.mjs';

export * from './project_files.mjs';
export {uartPair} from './network_examples.mjs';
