import registry from './boards.json' with {type:'json'};
export const BOARDS=Object.freeze(registry);
export function boardProfile(id){if(!BOARDS[id])throw Error('Unsupported board profile.');return BOARDS[id];}
export const isAVR=id=>['atmega328p','atmega2560'].includes(boardProfile(id).family);
