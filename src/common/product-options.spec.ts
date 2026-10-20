import { normalizeSpecifications, variantIndex, storedVariants } from './product-options';
describe('product option normalization',()=>{
  it('normalizes case, plural and regional names and preserves custom specifications',()=>{
    expect(normalizeSpecifications({' COLORS ':' Rose gold ',sizes:'6.7 inches'})).toEqual({Color:'Rose gold',Size:'6.7 inches'});
  });
  it('rejects aliases that would overwrite each other',()=>expect(()=>normalizeSpecifications({colors:'Red',Colours:'Blue'})).toThrow(/unique/));
  it('preserves measurements and custom option names',()=>expect(normalizeSpecifications({'SCREEN_SIZE':'6.7 inches',storage:'256 GB','handmade finish':'Matte'})).toEqual({'Screen size':'6.7 inches',Storage:'256 GB','Handmade Finish':'Matte'}));
  it('rejects non-string values',()=>expect(()=>normalizeSpecifications({Color:42})).toThrow());
  it('matches all option dimensions independently of casing and key order',()=>{
    const variants=storedVariants([{color:'Rose gold',size:'6.7 inches',type:'With charger',options:{Storage:'256 GB'},quantity:2}]);
    expect(variantIndex(variants,{storage:'256 gb',Option:'With charger',Size:'6.7 inches',Color:'ROSE GOLD'})).toBe(0);
    expect(variantIndex(variants,{Color:'Rose gold',Size:'6.7 inches'})).toBe(-1);
    expect(variantIndex(variants,{Color:'Blue'})).toBe(-1);
  });
});
