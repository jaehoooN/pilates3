// 로컬 환경변수 파일 로드
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class PilatesBooking {
    constructor() {
        this.username = process.env.PILATES_USERNAME; // 회원이름
        this.password = process.env.PILATES_PASSWORD; // 회원번호
        this.baseUrl = 'https://ad2.mbgym.kr';
        this.maxRetries = 3;
        this.retryDelay = 1000;
        
        // 테스트 모드 설정
        this.testMode = process.env.TEST_MODE === 'true';
        this.skipWait = process.env.SKIP_WAIT === 'true';
    }

    async init() {
        try {
            await fs.mkdir('screenshots', { recursive: true });
            await fs.mkdir('logs', { recursive: true });
        } catch (err) {
            console.log('디렉토리 생성 중 오류 (무시 가능):', err.message);
        }
        
        const timestamp = new Date().toISOString();
        await this.log(`=== 예약 시작: ${timestamp} ===`);
        
        if (this.testMode) {
            await this.log('⚠️ 테스트 모드로 실행 중 (실제 예약하지 않음)');
        }
    }

    async log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        console.log(message);
        
        const logFile = this.testMode ? 'logs/test.log' : 'logs/booking.log';
        await fs.appendFile(logFile, logMessage).catch(() => {});
    }

    async takeScreenshot(page, name) {
        try {
            await fs.mkdir('screenshots', { recursive: true });
            
            const timestamp = Date.now();
            const prefix = this.testMode ? 'test-' : '';
            const filename = `screenshots/${prefix}${name}-${timestamp}.png`;
            await page.screenshot({ path: filename, fullPage: true });
            await this.log(`📸 스크린샷 저장: ${filename}`);
            return filename;
        } catch (error) {
            await this.log(`⚠️ 스크린샷 실패: ${error.message}`);
        }
    }

    async login(page) {
        await this.log('🔐 로그인 시도...');
        
        try {
            // 인코딩 설정
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'ko-KR,ko;q=0.9',
                'Accept-Charset': 'UTF-8'
            });
            
            // 로그인 페이지로 이동
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=102`, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            await this.takeScreenshot(page, '01-login-page');
            
            // 이미 로그인된 상태인지 확인
            const logoutLink = await page.$('a[href*="yeout.php"]');
            if (logoutLink) {
                await this.log('✅ 이미 로그인된 상태');
                return true;
            }
            
            // 로그인 폼 입력 - ID 기반 선택자 사용
            await page.waitForSelector('input#user_id, input[name="name"]', { timeout: 10000 });
            
            // ID 기반 선택자 우선 사용
            const useridSelector = await page.$('input#user_id') ? 'input#user_id' : 'input[name="name"]';
            const passwdSelector = await page.$('input#passwd') ? 'input#passwd' : 'input[name="passwd"]';
            
            // 입력 필드 클리어 후 입력
            await page.click(useridSelector, { clickCount: 3 });
            await page.type(useridSelector, this.username, { delay: 50 });
            
            await page.click(passwdSelector, { clickCount: 3 });
            await page.type(passwdSelector, this.password, { delay: 50 });
            
            await this.log(`📝 입력 정보: 이름=${this.username}, 번호=${this.password}`);
            
            // 로그인 버튼 클릭
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click('input[type="submit"]')
            ]);
            
            await this.takeScreenshot(page, '02-after-login');
            
            // 로그인 성공 확인
            const currentUrl = page.url();
            if (currentUrl.includes('res_postform.php')) {
                await this.log('✅ 로그인 성공 - 예약 페이지 진입');
                return true;
            }
            
            await this.log('✅ 로그인 완료');
            return true;
            
        } catch (error) {
            await this.log(`❌ 로그인 실패: ${error.message}`);
            throw error;
        }
    }

    async navigateToBookingPage(page) {
        await this.log('📅 예약 페이지로 이동...');
        
        // 7일 후 날짜 계산
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 7);
        const day = targetDate.getDate();
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth() + 1;
        
        await this.log(`📆 예약 날짜: ${year}년 ${month}월 ${day}일`);
        
        // 현재 페이지가 이미 예약 페이지인지 확인
        const currentUrl = page.url();
        if (currentUrl.includes('res_postform.php')) {
            await this.log('📍 이미 예약 페이지에 있음');
            
            // 해당 날짜 클릭
            const dateClicked = await page.evaluate((targetDay) => {
                const cells = document.querySelectorAll('td');
                
                for (let cell of cells) {
                    const text = cell.textContent.trim();
                    
                    // 정확한 날짜 매칭
                    if (text === String(targetDay) || 
                        (text.startsWith(String(targetDay)) && !text.includes('X'))) {
                        
                        // 클릭 가능한 요소 찾기
                        const link = cell.querySelector('a');
                        if (link) {
                            // onclick 속성 확인
                            const onclickAttr = link.getAttribute('onclick');
                            if (onclickAttr) {
                                console.log('onclick 발견:', onclickAttr);
                                // JavaScript 함수 직접 실행
                                try {
                                    eval(onclickAttr);
                                } catch(e) {
                                    link.click();
                                }
                            } else {
                                link.click();
                            }
                            return true;
                        } else if (!text.includes('X')) {
                            cell.click();
                            return true;
                        }
                    }
                }
                return false;
            }, day);
            
            if (dateClicked) {
                await this.log(`✅ ${day}일 클릭 완료`);
                // 페이지 로드 대기
                await page.waitForTimeout(3000);
            } else {
                await this.log(`⚠️ ${day}일 예약 불가 또는 마감`);
            }
        }
        
        await this.takeScreenshot(page, '03-booking-page');
        return { year, month, day };
    }

    async find1030ClassAndBook(page) {
        await this.log('🔍 10:30 수업 찾는 중...');
        
        try {
            // 테이블 로드 대기
            await page.waitForSelector('table', { timeout: 5000 }).catch(() => {
                this.log('⚠️ 테이블 로드 대기 시간 초과');
            });
            
            await this.takeScreenshot(page, '04-time-table');
            
            // 개선된 10:30 수업 찾기 로직
            const result = await page.evaluate(() => {
                // 디버깅을 위한 상세 로그
                console.log('=== 10:30 수업 검색 시작 ===');
                
                // 1. 모든 테이블 수집 및 분석
                const tables = document.querySelectorAll('table');
                console.log(`전체 테이블 수: ${tables.length}`);
                
                let timeTable = null;
                let tableIndex = -1;
                
                // 각 테이블 분석
                for (let i = 0; i < tables.length; i++) {
                    const table = tables[i];
                    const tableText = table.textContent || '';
                    
                    // 테이블 내용 일부 출력 (디버깅용)
                    console.log(`테이블 ${i} 샘플:`, tableText.substring(0, 100));
                    
                    // 시간표 테이블 식별 조건들
                    const hasTimePattern = /\d{1,2}[:：]\d{2}/.test(tableText);
                    const hasReservationKeyword = tableText.includes('예약') || tableText.includes('신청');
                    const hasClassKeyword = tableText.includes('수강') || tableText.includes('수업');
                    
                    // 제외 조건: JavaScript나 CSS 코드가 포함된 테이블
                    const hasScriptCode = tableText.includes('function') || 
                                         tableText.includes('script') || 
                                         tableText.includes('{') ||
                                         tableText.includes('css');
                    
                    if (hasTimePattern && hasReservationKeyword && !hasScriptCode) {
                        // 추가 검증: 실제 시간표인지 확인
                        const rows = table.querySelectorAll('tr');
                        let validTimeCount = 0;
                        
                        for (let row of rows) {
                            const cells = row.querySelectorAll('td');
                            for (let cell of cells) {
                                const cellText = cell.textContent.trim();
                                // 시간 형식 확인 (XX:XX)
                                if (/^\d{1,2}[:：]\d{2}/.test(cellText) || 
                                    /오전\s*\d{1,2}[:：]\d{2}/.test(cellText) ||
                                    /오후\s*\d{1,2}[:：]\d{2}/.test(cellText)) {
                                    validTimeCount++;
                                }
                            }
                        }
                        
                        // 여러 시간이 있는 테이블이 시간표일 가능성이 높음
                        if (validTimeCount >= 2) {
                            timeTable = table;
                            tableIndex = i;
                            console.log(`✅ 시간표 테이블 발견! (테이블 ${i}, 시간 항목 ${validTimeCount}개)`);
                            break;
                        }
                    }
                }
                
                // 시간표를 못 찾은 경우 대체 방법
                if (!timeTable) {
                    console.log('⚠️ 명시적 시간표를 찾지 못함. 대체 방법 시도...');
                    
                    // 가장 많은 시간 정보를 가진 테이블 찾기
                    let maxTimeCount = 0;
                    let bestTable = null;
                    
                    for (let i = 0; i < tables.length; i++) {
                        const table = tables[i];
                        const tableText = table.textContent || '';
                        
                        // 스크립트 코드가 있는 테이블 제외
                        if (tableText.includes('function') || tableText.includes('script')) {
                            continue;
                        }
                        
                        const timeMatches = tableText.match(/\d{1,2}[:：]\d{2}/g);
                        if (timeMatches && timeMatches.length > maxTimeCount) {
                            maxTimeCount = timeMatches.length;
                            bestTable = table;
                            tableIndex = i;
                        }
                    }
                    
                    if (bestTable && maxTimeCount >= 2) {
                        timeTable = bestTable;
                        console.log(`✅ 대체 시간표 발견 (테이블 ${tableIndex}, 시간 ${maxTimeCount}개)`);
                    }
                }
                
                if (!timeTable) {
                    return {
                        found: false,
                        message: '시간표 테이블을 찾을 수 없음'
                    };
                }
                
                // 2. 시간표 테이블에서 10:30 수업 찾기
                const rows = timeTable.querySelectorAll('tr');
                console.log(`시간표 행 수: ${rows.length}`);
                
                // 헤더 행 찾기 (열 구조 파악)
                let headerRow = null;
                let timeColumnIndex = -1;
                let actionColumnIndex = -1;
                
                for (let i = 0; i < Math.min(3, rows.length); i++) {
                    const cells = rows[i].querySelectorAll('th, td');
                    for (let j = 0; j < cells.length; j++) {
                        const cellText = cells[j].textContent.trim();
                        if (cellText.includes('시간') || cellText.includes('수강시간')) {
                            timeColumnIndex = j;
                            headerRow = rows[i];
                        }
                        if (cellText.includes('예약') || cellText.includes('신청')) {
                            actionColumnIndex = j;
                        }
                    }
                }
                
                console.log(`시간 열: ${timeColumnIndex}, 예약 열: ${actionColumnIndex}`);
                
                // 각 행 검사
                for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                    const row = rows[rowIndex];
                    const cells = row.querySelectorAll('td');
                    
                    if (cells.length < 2) continue; // 최소 2개 열은 있어야 함
                    
                    // 시간 찾기 - 여러 방법으로 시도
                    let found1030 = false;
                    let timeCell = null;
                    let timeCellIndex = -1;
                    
                    // 방법 1: 헤더에서 파악한 시간 열 사용
                    if (timeColumnIndex >= 0 && timeColumnIndex < cells.length) {
                        const cellText = cells[timeColumnIndex].textContent.trim();
                        if (this.check1030Time(cellText)) {
                            found1030 = true;
                            timeCell = cells[timeColumnIndex];
                            timeCellIndex = timeColumnIndex;
                            console.log(`✅ 방법1: 10:30 발견 (열 ${timeColumnIndex}): ${cellText}`);
                        }
                    }
                    
                    // 방법 2: 모든 셀 검사
                    if (!found1030) {
                        for (let i = 0; i < cells.length; i++) {
                            const cellText = cells[i].textContent.trim();
                            if (this.check1030Time(cellText)) {
                                found1030 = true;
                                timeCell = cells[i];
                                timeCellIndex = i;
                                console.log(`✅ 방법2: 10:30 발견 (열 ${i}): ${cellText}`);
                                break;
                            }
                        }
                    }
                    
                    // 10:30 수업을 찾은 경우
                    if (found1030) {
                        console.log(`🎯 10:30 수업 확인! 행: ${rowIndex}`);
                        
                        // 예약 버튼 찾기
                        let actionCell = null;
                        
                        // 우선순위 1: 헤더에서 파악한 예약 열
                        if (actionColumnIndex >= 0 && actionColumnIndex < cells.length) {
                            actionCell = cells[actionColumnIndex];
                        }
                        
                        // 우선순위 2: 시간 열 다음 열
                        if (!actionCell && timeCellIndex >= 0 && timeCellIndex < cells.length - 1) {
                            actionCell = cells[timeCellIndex + 1];
                        }
                        
                        // 우선순위 3: 마지막 열
                        if (!actionCell) {
                            actionCell = cells[cells.length - 1];
                        }
                        
                        // 우선순위 4: 예약 관련 텍스트가 있는 셀 찾기
                        if (!actionCell || !actionCell.textContent.trim()) {
                            for (let j = 0; j < cells.length; j++) {
                                const text = cells[j].textContent.trim();
                                if (text.includes('예약') || text.includes('대기') || 
                                    text.includes('신청') || text.includes('취소')) {
                                    actionCell = cells[j];
                                    break;
                                }
                            }
                        }
                        
                        if (actionCell) {
                            const actionText = actionCell.textContent.trim();
                            const actionHTML = actionCell.innerHTML;
                            console.log(`예약 셀 내용: ${actionText}`);
                            console.log(`예약 셀 HTML 일부: ${actionHTML.substring(0, 200)}`);
                            
                            // 링크 찾기
                            const link = actionCell.querySelector('a');
                            
                            // 예약하기 처리
                            if (actionText.includes('예약하기') || actionText === '예약하기') {
                                if (link) {
                                    console.log('예약하기 링크 발견');
                                    link.click();
                                    return {
                                        found: true,
                                        booked: true,
                                        message: '10:30 수업 예약 클릭 완료',
                                        needSubmit: true
                                    };
                                }
                            }
                            
                            // 대기예약 처리
                            else if (actionText.includes('대기')) {
                                if (link) {
                                    console.log('대기예약 링크 발견');
                                    link.click();
                                    return {
                                        found: true,
                                        booked: true,
                                        message: '10:30 수업 대기예약 클릭',
                                        isWaitingOnly: true,
                                        needSubmit: true
                                    };
                                }
                            }
                            
                            // 이미 예약됨
                            else if (actionText.includes('취소') || actionText.includes('삭제')) {
                                return {
                                    found: true,
                                    booked: false,
                                    message: '10:30 수업은 이미 예약되어 있음'
                                };
                            }
                            
                            // 예약 불가
                            else {
                                return {
                                    found: true,
                                    booked: false,
                                    message: `10:30 수업 예약 불가 (상태: ${actionText})`
                                };
                            }
                        }
                    }
                }
                
                // 10:30을 찾지 못한 경우
                return {
                    found: false,
                    booked: false,
                    message: '10:30 수업을 찾을 수 없음'
                };
                
                // 헬퍼 함수: 10:30 시간 확인
                function check1030Time(text) {
                    // 정확한 10:30 패턴들
                    const patterns = [
                        /^10[:：]30$/,                    // 정확히 10:30
                        /^오전\s*10[:：]30$/,              // 오전 10:30
                        /^AM\s*10[:：]30$/i,               // AM 10:30
                        /10[:：]30\s*[-~]/,                // 10:30~
                        /^\d{1,2}[:：]30.*10[:：]30/       // XX:30~10:30
                    ];
                    
                    // 제외 패턴 (09:30 등)
                    const excludePatterns = [
                        /09[:：]30/,
                        /9[:：]30/,
                        /11[:：]30/,
                        /12[:：]30/
                    ];
                    
                    // 제외 패턴 체크
                    for (let pattern of excludePatterns) {
                        if (pattern.test(text)) {
                            return false;
                        }
                    }
                    
                    // 포함 패턴 체크
                    for (let pattern of patterns) {
                        if (pattern.test(text)) {
                            return true;
                        }
                    }
                    
                    // 단순 문자열 체크
                    if (text === '10:30' || text === '오전 10:30' || text === 'AM 10:30') {
                        return true;
                    }
                    
                    // "10:30"이 포함되어 있고 다른 시간이 없는 경우
                    if (text.includes('10:30') && !text.includes('09:30') && !text.includes('11:30')) {
                        return true;
                    }
                    
                    return false;
                }
                
                // this 바인딩을 위해 헬퍼 함수를 내부에 정의
                this.check1030Time = check1030Time;
            });
            
            await this.log(`🔍 검색 결과: ${result.message}`);
            
            // 예약 클릭 후 처리
            if (result.booked) {
                await this.log('⏳ 예약 처리 대기 중...');
                
                // confirm 대화상자 처리 (대기예약의 경우)
                if (result.isWaitingOnly) {
                    page.once('dialog', async dialog => {
                        await this.log(`📢 대기예약 확인: ${dialog.message()}`);
                        await dialog.accept();
                    });
                }
                
                await page.waitForTimeout(2000);
                
                // Submit 버튼 처리
                if (result.needSubmit && !this.testMode) {
                    await this.log('📝 Submit 버튼 찾는 중...');
                    
                    const submitSuccess = await page.evaluate(() => {
                        // Submit 버튼 찾기 - 다양한 선택자 시도
                        const submitSelectors = [
                            'input[type="submit"][value*="예약"]',
                            'input[type="submit"][value*="확인"]',
                            'button[type="submit"]',
                            'input[type="submit"]',
                            'button:contains("예약")',
                            'button:contains("확인")'
                        ];
                        
                        for (let selector of submitSelectors) {
                            try {
                                const elements = document.querySelectorAll(selector);
                                for (let elem of elements) {
                                    const text = elem.textContent || elem.value || '';
                                    if (text.includes('예약') || text.includes('확인') || text.includes('등록')) {
                                        console.log(`Submit 버튼 발견: ${text}`);
                                        elem.click();
                                        return true;
                                    }
                                }
                            } catch (e) {
                                // 선택자 오류 무시
                            }
                        }
                        
                        // 모든 submit 타입 버튼 확인
                        const allSubmits = document.querySelectorAll('input[type="submit"], button[type="submit"]');
                        if (allSubmits.length > 0) {
                            console.log(`Submit 버튼 클릭 (첫 번째): ${allSubmits[0].value || allSubmits[0].textContent}`);
                            allSubmits[0].click();
                            return true;
                        }
                        
                        return false;
                    });
                    
                    if (submitSuccess) {
                        await this.log('✅ Submit 완료!');
                        await page.waitForTimeout(2000);
                        await this.takeScreenshot(page, '06-after-submit');
                    } else {
                        await this.log('⚠️ Submit 버튼을 찾을 수 없음');
                    }
                }
                
                await this.takeScreenshot(page, '07-booking-result');
            }
            
            return result;
            
        } catch (error) {
            await this.log(`❌ 예약 과정 에러: ${error.message}`);
            await this.takeScreenshot(page, 'error-booking');
            throw error;
        }
    }

    async verifyBooking(page) {
        await this.log('🔍 예약 확인 중...');
        
        try {
            // 예약 확인 페이지로 이동
            await page.goto(`${this.baseUrl}/yeapp/yeapp.php?tm=103`, {
                waitUntil: 'networkidle2'
            });
            
            await page.waitForTimeout(2000);
            
            // 캘린더에서 확인 (대기예약은 * 표시)
            const bookingVerified = await page.evaluate(() => {
                const bodyText = document.body.innerText;
                
                // 7일 후 날짜 계산
                const targetDate = new Date();
                targetDate.setDate(targetDate.getDate() + 7);
                const month = targetDate.getMonth() + 1;
                const day = targetDate.getDate();
                
                // 10:30 수업 확인
                const has1030 = bodyText.includes('10:30');
                const hasDate = bodyText.includes(`${month}월`) && bodyText.includes(`${day}일`);
                
                // 대기예약 확인 (* 표시)
                const hasWaitingMark = bodyText.includes('*');
                
                if (has1030 && hasDate) {
                    return { verified: true, isWaiting: hasWaitingMark };
                }
                
                return { verified: false, isWaiting: false };
            });
            
            if (bookingVerified.verified) {
                if (bookingVerified.isWaiting) {
                    await this.log('✅ 대기예약이 정상적으로 확인되었습니다! (*)');
                } else {
                    await this.log('✅ 예약이 정상적으로 확인되었습니다!');
                }
                await this.takeScreenshot(page, '08-booking-verified');
                return true;
            } else {
                await this.log('⚠️ 예약 내역에서 확인되지 않음');
                await this.takeScreenshot(page, '08-booking-not-found');
                return false;
            }
            
        } catch (error) {
            await this.log(`⚠️ 예약 확인 실패: ${error.message}`);
            return false;
        }
    }

    async run() {
        await this.init();
        
        // 12시 대기 (필요한 경우)
        if (!this.skipWait && !this.testMode) {
            const waitScript = require('./wait-until-noon');
            await waitScript.waitUntilNoon();
        }
        
        let retryCount = 0;
        let success = false;
        
        while (retryCount < this.maxRetries && !success) {
            const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
            const isCI = process.env.CI === 'true';
            
            const browser = await puppeteer.launch({
                headless: process.env.HEADLESS !== 'false' ? 'new' : false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--window-size=1920,1080',
                    '--lang=ko-KR',
                    ...(isGitHubActions || isCI ? ['--single-process', '--no-zygote'] : [])
                ]
            });
            
            try {
                const page = await browser.newPage();
                
                // 페이지 인코딩 설정
                await page.evaluateOnNewDocument(() => {
                    document.charset = "UTF-8";
                });
                
                // 설정
                page.setDefaultTimeout(30000);
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
                await page.setViewport({ width: 1920, height: 1080 });
                
                // 콘솔 로그 캡처
                page.on('console', msg => {
                    if (msg.type() === 'log') {
                        this.log(`[브라우저]: ${msg.text()}`);
                    }
                });
                
                // 알림 처리
                page.on('dialog', async dialog => {
                    const message = dialog.message();
                    await this.log(`📢 알림: ${message}`);
                    
                    // 예약 성공 메시지 확인
                    if (message.includes('예약') && 
                        (message.includes('완료') || message.includes('성공'))) {
                        success = true;
                        await this.log('🎉 예약 성공 알림 확인!');
                    }
                    
                    // 로그인 실패 메시지 확인
                    if (message.includes('등록되어 있지 않습니다')) {
                        await dialog.accept();
                        throw new Error('로그인 정보 오류');
                    }
                    
                    await dialog.accept();
                });
                
                // 1. 로그인
                await this.login(page);
                
                // 2. 예약 페이지로 이동
                const dateInfo = await this.navigateToBookingPage(page);
                
                // 3. 10:30 수업 찾고 예약
                const result = await this.find1030ClassAndBook(page);
                
                // 4. 예약 확인 (테스트 모드가 아닌 경우)
                if (!this.testMode && result.booked) {
                    const verified = await this.verifyBooking(page);
                    if (verified) {
                        success = true;
                    }
                } else if (this.testMode && result.found) {
                    success = true;
                }
                
                if (success) {
                    await this.log('🎉🎉🎉 프로세스 완료! 🎉🎉🎉');
                    
                    // 결과 저장
                    const resultInfo = {
                        timestamp: new Date().toISOString(),
                        date: `${dateInfo.year}-${dateInfo.month}-${dateInfo.day}`,
                        class: '10:30',
                        status: this.testMode ? 'TEST' : (result.isWaitingOnly ? 'WAITING' : 'SUCCESS'),
                        message: result.message,
                        verified: !this.testMode ? success : null
                    };
                    
                    const resultFile = this.testMode ? 'test-result.json' : 'booking-result.json';
                    await fs.writeFile(
                        resultFile,
                        JSON.stringify(resultInfo, null, 2)
                    );
                    
                    if (result.isWaitingOnly) {
                        await this.log('⚠️ 대기예약으로 등록되었습니다. 취소가 발생하면 자동으로 예약됩니다.');
                    }
                } else if (result.found) {
                    await this.log('⚠️ 10:30 수업은 있지만 예약 불가');
                    break;
                } else {
                    throw new Error('10:30 수업을 찾을 수 없음');
                }
                
            } catch (error) {
                retryCount++;
                await this.log(`❌ 시도 ${retryCount}/${this.maxRetries} 실패: ${error.message}`);
                
                if (retryCount < this.maxRetries) {
                    await this.log(`⏳ ${this.retryDelay/1000}초 후 재시도...`);
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            } finally {
                await browser.close();
            }
        }
        
        if (!success) {
            await this.log('❌❌❌ 예약 실패 ❌❌❌');
            process.exit(1);
        }
    }
}

// 환경변수 확인
if (!process.env.PILATES_USERNAME || !process.env.PILATES_PASSWORD) {
    console.error('❌ 환경변수가 필요합니다:');
    console.error('   PILATES_USERNAME: 회원이름');
    console.error('   PILATES_PASSWORD: 회원번호');
    console.error('');
    console.error('💡 설정 방법:');
    console.error('   1. .env 파일 생성 (로컬)');
    console.error('   2. GitHub Secrets 설정 (GitHub Actions)');
    process.exit(1);
}

// 실행
const booking = new PilatesBooking();
booking.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
