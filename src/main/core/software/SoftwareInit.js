import GetUserPath from '@/shared/utils/GetUserPath'
import FileUtil from '@/main/utils/FileUtil'
import nodePath from 'path'
import SoftwareExtend from '@/main/core/software/SoftwareExtend'
import DirUtil from '@/main/utils/DirUtil'
import Php from '@/main/core/php/Php'
import Database from '@/main/core/Database'
import { isWindows } from '@/main/utils/utils'

export default class SoftwareInit {
    static async initAll() {
        await Promise.all([this.initNginx(), this.initAllPHP(), this.initAllMySQL()])
    }

    static async initNginx() {
        try {
            let path = nodePath.join(GetUserPath.getNginxConfDir(), 'nginx.conf')
            let text = await FileUtil.ReadAll(path)
            let pattern = /root.+/g
            let wwwPath = nodePath.join(GetUserPath.getNginxDir(), 'html').replaceSlash()
            let replaceStr = `root ${wwwPath};`
            text = text.replaceAll(pattern, replaceStr)

            await FileUtil.WriteAll(path, text)

            await this.initNginxLocalhostConf()
            await this.initNginxPhpmyadminConf()
        } catch (error) {
            throw new Error(`初始化Nginx配置失败！${error.message}`)
        }
    }

    static async initNginxLocalhostConf() {
        let path = nodePath.join(GetUserPath.getNginxVhostsDir(), 'localhost_80.conf')
        if (await FileUtil.Exists(path)) {
            let text = await FileUtil.ReadAll(path)
            let pattern = /root.+/g
            let rootPath = nodePath.join(GetUserPath.getWebsiteDir(), 'localhost').replaceSlash()
            let replaceStr = `root ${rootPath};`
            text = text.replaceAll(pattern, replaceStr)
            await FileUtil.WriteAll(path, text)
        }
    }

    static async initNginxPhpmyadminConf() {
        let path = nodePath.join(GetUserPath.getNginxVhostsDir(), 'localhost_888.conf')
        if (await FileUtil.Exists(path)) {
            let text = await FileUtil.ReadAll(path)
            let pattern = /root.+/g
            let rootPath = nodePath.join(GetUserPath.getToolTypeDir(), 'phpMyAdmin').replaceSlash()
            let replaceStr = `root ${rootPath};`
            text = text.replaceAll(pattern, replaceStr)
            await FileUtil.WriteAll(path, text)
        }
    }

    static async initAllPHP() {
        const phpList = await SoftwareExtend.getPHPList()
        for (const item of phpList) {
            await this.initPHP(item.version)
        }
    }

    static async initPHP(version) {
        await this.initPHPConf(version)
        if (!isWindows) {
            await this.createPHPFpmConf(version)
        }
    }

    static async createPHPFpmConf(version) {
        let phpDirPath = GetUserPath.getPhpDir(version)
        let confPath = nodePath.join(phpDirPath, 'etc/php-fpm.conf')
        if (!await FileUtil.Exists(confPath)) {
            await FileUtil.WriteAll(confPath, Php.getFpmConfTemplate(version))
        }
    }

    static async initPHPConf(version) {
        try {
            const confDir = Php.getConfDir(version)
            const confPath = Php.getConfPath(version)

            if (!(await FileUtil.Exists(confPath))) {
                await FileUtil.Copy(nodePath.join(confDir, 'php.ini-development'), confPath)
            }

            let text = await FileUtil.ReadAll(confPath)

            text = text.replace(/(?<=\n);?.?max_execution_time\s*=.*/, 'max_execution_time = 300')
            text = text.replace(/(?<=\n);?.?memory_limit\s*=.*/, 'memory_limit = 512M')
            text = text.replace(/(?<=\n);?.?post_max_size\s*=.*/, 'post_max_size = 256M')
            text = text.replace(/(?<=\n);?.?upload_max_filesize\s*=.*/, 'upload_max_filesize = 200M')
            text = text.replace(/(?<=\n);?.?date.timezone\s*=.*/, 'date.timezone = Asia/Shanghai')

            if (isWindows) {
                let i = 0
                text = text.replace(/(?<=\n);?.?extension_dir\s*=.*/g, match => {
                    //仅替换第二个
                    return ++i === 2 ? 'extension_dir = "ext"' : match
                })

                const extArr = ['bz2', 'curl', 'fileinfo', 'mbstring', 'exif', 'mysqli', 'openssl',
                    'pdo_mysql', 'pdo_odbc', 'soap', 'sockets']

                const versionFloat = parseFloat(version)

                if (versionFloat >= 7.2) {
                    extArr.push('gd')
                    extArr.push('sodium')
                    extArr.push('odbc')
                } else {
                    extArr.push('gd2')
                }

                if (versionFloat >= 8.2){
                    extArr.push('zip')
                }

                for (const ext of extArr) {
                    text = Php.switchExtensionByText(version, text, ext, true)
                }
            } else {
                //非Windows系统
                const extDir = await Php.getExtensionDir(version)
                //仅替换第一个
                text = text.replace(/(?<=\n);?.?extension_dir\s*=.*/, `extension_dir = "${extDir}"`)

                const extArr = ['curl', 'gd', 'openssl']
                for (const ext of extArr) {
                    text = Php.addExtensionByText(version, text, ext)
                }
            }

            let phpTempPath = nodePath.join(GetUserPath.geTempDir(), 'php')
            let uploadPattern = /(?<=\n);?.?upload_tmp_dir\s*=.*/g
            let replaceUploadStr = `upload_tmp_dir = "${phpTempPath.replaceSlash()}"`
            text = text.replaceAll(uploadPattern, replaceUploadStr)

            let sessionPattern = /(?<=\n);?.?session.save_path\s*=.*/g
            let replaceSessionStr = `session.save_path = "${phpTempPath.replaceSlash()}"`
            text = text.replaceAll(sessionPattern, replaceSessionStr)

            await FileUtil.WriteAll(confPath, text)
        } catch (error) {
            throw new Error(`初始化PHP配置失败！${error.message}`)
        }
    }

    static async initAllMySQL() {
        const mysqlList = await SoftwareExtend.getMySQLList()
        for (const item of mysqlList) {
            await this.initMySQL(item.version)
        }
    }

    /**
     * 初始化MySQL data目录和重置密码
     * @returns {Promise<void>}
     */
    static async initMySQL(version) {
        await this.initMySQLConf(version)
        if (!await DirUtil.Exists(GetUserPath.getMysqlDataDir(version))) {
            //如果mysql data目录不存在，初始化生成data目录，并重置密码
            await Database.initMySQLData(version)
            await Database.resetMySQLPassword(version)
        }
    }

    static async initMySQLConf(version) {
        try {
            let mysqlDir = GetUserPath.getMysqlDir(version)
            let confPath = isWindows ? nodePath.join(mysqlDir, 'my.ini') : nodePath.join(mysqlDir, 'my.cnf')
            let text = await FileUtil.ReadAll(confPath)
            let mysqlPath = GetUserPath.getMysqlDir(version)

            //(?<=\n)basedir\s*=\s*.+
            let basePattern = /(?<=\n)basedir\s*=\s*.+/g
            let replaceBaseStr = `basedir = "${mysqlPath.replaceSlash()}"`
            text = text.replaceAll(basePattern, replaceBaseStr)

            //(?<=\n)datadir\s*=\s*.+
            let dataPattern = /(?<=\n)datadir\s*=\s*.+/g
            let dataPath = GetUserPath.getMysqlDataDir(version)
            let replaceDataStr = `datadir = "${dataPath.replaceSlash()}"`
            text = text.replaceAll(dataPattern, replaceDataStr)

            //(?<=\n)log-error\s*=\s*.+
            let logPattern = /(?<=\n)log-error\s*=\s*.+/g
            let logPath = nodePath.join(mysqlPath, 'logs', 'mysql.log')
            let replaceLogStr = `log-error = "${logPath.replaceSlash()}"`
            text = text.replaceAll(logPattern, replaceLogStr)

            await FileUtil.WriteAll(confPath, text)
        } catch (error) {
            throw new Error(`初始化MySQL配置失败！${error.message}`)
        }
    }
}
