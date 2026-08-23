// SSH 로 붙어 수신함을 대신 깔아 준다 — 사람은 터미널을 안 본다.
//
// ★여기는 **명령을 만들고 결과를 읽는 일만** 한다. 실제로 붙는 것은 안드로이드
//   플러그인(SshPlugin)이다. 그래야 Node 에서 이 파일을 그대로 검사할 수 있다
//   (다른 조회 계층과 같은 규칙).
//
// ★비밀번호는 저장하지 않는다. 한 번 쓰고 버린다. 설치가 끝나면 앱이 쓰는 것은
//   수신함 토큰뿐이라, 서버 로그인 비밀번호를 들고 있을 이유가 없다.
'use strict';

const Ssh = (function () {
  /** 셸에 안전하게 넘기려고 작은따옴표로 감싼다. */
  function quote(s) {
    return "'" + String(s === undefined || s === null ? '' : s).replace(/'/g, "'\\''") + "'";
  }

  /**
   * 설치 명령을 만든다.
   * @param {object} o {repo, ref, open, root}
   *   root=true 면 sudo 를 안 붙인다 (root 로 로그인한 경우).
   */
  function installCommand(o) {
    const opt = o || {};
    const repo = String(opt.repo || 'lulus-cat/peropix-mobile');
    const ref = String(opt.ref || 'main');
    const url = 'https://raw.githubusercontent.com/' + repo + '/' + ref + '/tools/deploy/install.sh';
    const args = opt.open ? ' -s -- --open' : '';
    const inner = 'curl -fsSL ' + quote(url) + ' | bash' + args;
    // ★root 가 아니면 sudo 로 올린다. -S 는 비밀번호를 stdin 에서 읽으라는 뜻이고
    //   -p '' 는 물어보는 글을 안 찍게 한다 (그 글이 결과에 섞이면 읽기 어렵다).
    //   inner 는 파이프로 자기 stdin 을 따로 쓰므로 비밀번호와 안 부딪힌다.
    return opt.root ? inner : ('sudo -S -p ' + quote('') + ' bash -c ' + quote(inner));
  }

  /**
   * 설치 결과에서 앱에 넣을 한 줄을 찾는다.
   * ★맨 끝에서 찾는다. 다시 깔면 예전 줄이 위에 남아 있을 수 있는데, 그때는
   *   **마지막 것**이 지금 값이다.
   */
  function parsePair(out) {
    const m = String(out || '').match(/peropix:\/\/[^\s'"]+/g);
    return m && m.length ? m[m.length - 1] : '';
  }

  /** 설치가 끝까지 갔는가. 한 줄이 안 나오면 무엇 때문인지 골라 준다. */
  function verdict(r) {
    const res = r || {};
    const out = String(res.out || '') + '\n' + String(res.err || '');
    const pair = parsePair(out);
    if (pair) return { ok: true, pair: pair };

    if (/密码|assword.*incorrect|Sorry, try again|sudo: no password|not in the sudoers/i.test(out)) {
      return { ok: false, why: '비밀번호가 틀렸거나 이 계정에 관리자 권한이 없습니다.' };
    }
    if (/command not found.*curl|curl: not found/i.test(out)) {
      return { ok: false, why: 'curl 이 없는 서버입니다. 「직접 깔기」 쪽을 써 주세요.' };
    }
    if (/Python 3\.8/i.test(out)) {
      return { ok: false, why: '파이썬이 너무 낮습니다 (3.8 이상이 필요합니다).' };
    }
    if (/Could not resolve host|Temporary failure in name resolution/i.test(out)) {
      return { ok: false, why: '서버가 인터넷에 못 나갑니다 (주소를 못 찾습니다).' };
    }
    if (res.code !== 0) {
      return { ok: false, why: '설치가 중간에 멈췄습니다 (코드 ' + res.code + ').' };
    }
    return { ok: false, why: '설치는 끝났는데 연결용 한 줄을 못 찾았습니다.' };
  }

  /** 붙다가 난 오류를 알아보기 쉽게. */
  function explain(e) {
    const msg = String((e && e.message) || e || '');
    if (/Auth fail|Auth cancel|USERAUTH fail/i.test(msg)) {
      return '아이디나 비밀번호가 맞지 않습니다.';
    }
    if (/UnknownHost|not known|resolve/i.test(msg)) return '그 주소를 찾지 못했습니다.';
    if (/timed? ?out|ETIMEDOUT/i.test(msg)) return '응답이 없습니다. 주소와 포트를 확인하세요.';
    if (/Connection refused|ECONNREFUSED/i.test(msg)) {
      return 'SSH 가 그 포트에서 안 듣고 있습니다 (기본은 22번).';
    }
    if (/HostKey|host key/i.test(msg)) return '서버 열쇠가 예전과 다릅니다.';
    return msg || '붙지 못했습니다.';
  }

  /**
   * 서버 열쇠가 바뀌었는가.
   * ★바뀌었다면 서버를 다시 깔았거나, 남이 중간에 끼어든 것이다. 조용히 넘기면 안 된다.
   */
  function keyChanged(saved, got) {
    return !!saved && !!got && saved !== got;
  }

  /** 주소에서 host 와 port 를 가른다. "1.2.3.4:2222" → {host, port} */
  function split(addr) {
    const s = String(addr || '').trim().replace(/^ssh:\/\//i, '');
    const m = s.match(/^([^:\s]+)(?::(\d+))?$/);
    if (!m) return { host: '', port: 22 };
    return { host: m[1], port: m[2] ? parseInt(m[2], 10) : 22 };
  }

  return {
    quote: quote,
    installCommand: installCommand,
    parsePair: parsePair,
    verdict: verdict,
    explain: explain,
    keyChanged: keyChanged,
    split: split
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Ssh;
