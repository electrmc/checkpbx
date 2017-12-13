module.exports.execshell = _execshellCB;

const ChildProcess = require('child_process');
function _execshellCB(sh,cb){
    return new Promise((resolve,reject)=>{
        let temp = sh;
        ChildProcess.exec(sh,{maxBuffer:5000*1024},function(err,data){
            if(err){
                reject({error:err,sh:sh});
            }
            if(cb){
                cb(data);
            }
            resolve(data);
        });
    }).catch((err)=>{
        console.log(err.error);
        console.log('shell : ',err.sh);
        process.exit();
    });
}