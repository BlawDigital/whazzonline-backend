import { BadRequestException } from '@nestjs/common';
export function normalizeOptionName(name: string) {
  const key = name.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  const aliases: Record<string,string> = {color:'Color', colors:'Color',colour:'Color',colours:'Color',size:'Size',sizes:'Size','screen size':'Screen size','screen sizes':'Screen size','add on':'Add-on','add ons':'Add-on',addon:'Add-on',addons:'Add-on'};
  return aliases[key] ?? key.replace(/\b\w/g, c => c.toUpperCase());
}
export function normalizeSpecifications(value: unknown): Record<string,string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Specifications must contain names and text values.');
  const result:Record<string,string> = {};
  if (Object.keys(value).length > 50) throw new BadRequestException('Use at most 50 specifications.');
  for (const [key,entry] of Object.entries(value)) {
    const name=normalizeOptionName(key);
    if (!name || name.length>80 || typeof entry !== 'string' || !entry.trim() || entry.length>1000 || ['__proto__','constructor','prototype'].includes(key.toLowerCase())) throw new BadRequestException('Complete each specification with a name and text value.');
    if (Object.hasOwn(result,name)) throw new BadRequestException('Each specification needs a unique name.');
    Object.defineProperty(result,name,{value:entry.trim(),enumerable:true,writable:true,configurable:true});
  }
  return result;
}

export type StoredProductVariant = {type?:string;color?:string;size?:string;quantity:number;imageIndexes?:number[];options?:Record<string,string>;[key:string]:unknown};
export function storedVariants(value:unknown):StoredProductVariant[] {
  return Array.isArray(value) ? value.filter((v):v is StoredProductVariant => !!v && typeof v === 'object' && typeof v.quantity === 'number') : [];
}
export function variantValues(v:StoredProductVariant):Record<string,string> {
  return {...(v.color ? {Color:v.color} : {}),...(v.size ? {Size:v.size} : {}),...(v.type ? {Option:v.type} : {}),...v.options};
}
export function variantIndex(variants:StoredProductVariant[], selection:unknown, color?:string|null, size?:string|null) {
  const supplied = {...(color ? {Color:color} : {}),...(size ? {Size:size} : {}),...(selection && typeof selection === 'object' && !Array.isArray(selection) ? selection : {})};
  const entries=Object.entries(supplied).map(([key,value])=>[normalizeOptionName(key),typeof value === 'string' ? value.trim().toLowerCase() : '']);
  if (!entries.length) return -1;
  return variants.findIndex(v=>{
    const choices=Object.fromEntries(Object.entries(variantValues(v)).map(([k,value])=>[normalizeOptionName(k),value.trim().toLowerCase()]));
    return entries.every(([k,value])=>choices[k] === value) && Object.keys(choices).every(k=>entries.some(([key])=>key === k));
  });
}
export function variantImage(product:{variants:unknown;imageUrls:string[]}, selection:unknown,color?:string|null,size?:string|null) {
  const variants=storedVariants(product.variants), index=variantIndex(variants,selection,color,size);
  return product.imageUrls[variants[index]?.imageIndexes?.[0] ?? 0] ?? '';
}
