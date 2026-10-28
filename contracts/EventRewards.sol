// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @notice One Sepolia demo event: one JPYC and one certificate per wallet.
contract EventRewards is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable jpyc;
    uint256 public constant reward = 1 ether; // JPYC has 18 decimals.
    mapping(address => uint256) public certificateOf;
    mapping(address => uint256) public registeredAt;
    uint256 public totalRegistered;

    event Registered(address indexed participant, uint256 indexed tokenId, uint256 amount);

    constructor(address token) ERC721("LIVE EVENT Participation", "LIVE") {
        require(block.chainid == 11155111, "Sepolia only");
        require(token.code.length > 0, "Token must be a contract");
        jpyc = IERC20(token);
    }

    function register() external nonReentrant {
        require(certificateOf[msg.sender] == 0, "Already registered");
        uint256 tokenId = ++totalRegistered;
        certificateOf[msg.sender] = tokenId;
        registeredAt[msg.sender] = block.timestamp;
        // Both changes revert together if the transfer fails.
        jpyc.safeTransfer(msg.sender, reward);
        // Mint only to the caller, including ERC-4337 accounts without a receiver hook.
        _mint(msg.sender, tokenId);
        emit Registered(msg.sender, tokenId, reward);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" rx="32" fill="#fce7ef"/><rect x="24" y="24" width="552" height="352" rx="24" fill="white" stroke="#a93665"/><text x="300" y="150" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#a93665">PARTICIPATION CERTIFICATE</text><text x="300" y="220" text-anchor="middle" font-family="sans-serif" font-size="42" fill="#493640">LIVE EVENT</text><text x="300" y="285" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#735963">Thank you for being here.</text></svg>';
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat(
            '{"name":"LIVE EVENT Participation Certificate","description":"Sepolia demo event registration certificate. One per wallet. This does not verify physical attendance.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)), '"}'
        ))));
    }
}
