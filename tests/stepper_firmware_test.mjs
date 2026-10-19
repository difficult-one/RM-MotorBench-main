import {execFileSync} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'mb-stepper-'));
try{for(const board of ['atype','ctype']){const dir=path.join(root,`basic_framework_${board}_usb-master/modules/motor_bench`),exe=path.join(temp,`${board}.exe`);execFileSync(process.env.NATIVE_CC||'gcc',['-std=c11','-Wall','-Wextra','-Werror','-I',dir,path.join(root,'tests/stepper_pulse_test.c'),path.join(dir,'stepper_pulse.c'),'-o',exe],{stdio:'inherit'});process.stdout.write(execFileSync(exe));}}finally{fs.rmSync(temp,{recursive:true,force:true});}
