// Local calibration presets, not claimed measurements of either original game.
// Only the offline practice adapter opts in; online/default core stays legacy.
const legacy=Object.freeze({id:'legacy',label:'Legacy',air:Object.freeze({}),timing:Object.freeze({}),walkEveryMs:70,chargeMs:0});
const reference=Object.freeze({id:'reference-v1',label:'Reference v1.1',dynamicDummy:true,
 // User playtest: shorter, heavier jump. Tall legacy shortcuts may now need
 // intermediate islands; do not preserve a moon jump just to pass old routes.
 air:Object.freeze({jumpImpulse:1600,gravity:2600,airAcceleration:3600,maxHorizontalSpeed:840,airDrag:3.8,terminalSpeed:2400}),
 timing:Object.freeze({basicFlightMode:'physical',basicLaunchDelayMs:90,basicSettleMs:350}),walkEveryMs:50,chargeMs:1200});
export const PRACTICE_PROFILES=Object.freeze({legacy,'reference-v1':reference});
export function practiceProfile(id='legacy'){
 const profile=PRACTICE_PROFILES[id];if(!profile)throw new RangeError('Unknown practice profile: '+id);return profile;
}
