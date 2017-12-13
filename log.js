'use strict'
const processTempDir = require('./setting').processTempDir;
const exec = require('./shell').execshell;
function Logobject (filePath){
    this.logFile = processTempDir + '/logfile';
}

Logobject.prototype.clear = async function(){
    let shStr = `rm -rf ${this.logFile}`;
    await exec(shStr);
}

Logobject.prototype.log = async function(str1,...strn){
    let string = str1;
    for(let temp of strn){
        string += temp;
    }
    let shStr = `echo "${string}" >> ${this.logFile}`;
    await exec(shStr);
}

Logobject.prototype.content = async function(){
    let shStr = `cat ${this.logFile}`;
    return await exec(shStr);
}

Logobject.prototype.deleteIneffectiveLog = async function (){
    let ary =  [".plist",".xcassets",".framework",".tbd",".app",
                "Pods_IHexin_","AppiraterLocalizable.strings",
                "Interface.storyboard","MainInterface.storyboard"];
    let length = ary.length;
    for(let i=0;i<length;i++){
        let str = ary[i];
        let deleteSh = `sed -i "" '/${str}/d' ${this.logFile}`;
        await exec(deleteSh);
    }
}

module.exports = new Logobject();